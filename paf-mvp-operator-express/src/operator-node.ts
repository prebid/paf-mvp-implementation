import { Request, Response } from 'express';
import cors from 'cors';
import { AxiosRequestConfig } from 'axios';
import {
  addIdentityEndpoint,
  Config,
  corsOptionsAcceptAll,
  getPafDataFromQueryString,
  getPayload,
  getTopLevelDomain,
  httpRedirect,
  Identity,
  Node,
  parseConfig,
  removeCookie,
  setCookie,
  VHostApp,
} from '@core/express';
import {
  IdentifierDefinition,
  IdsAndPreferencesDefinition,
  PublicKeyStore,
  RedirectContext,
  RequestVerifier,
  RequestWithBodyDefinition,
  RequestWithoutBodyDefinition,
  RestContext,
  Verifier,
} from '@core/crypto';
import { Log } from '@core/log';
import {
  DeleteIdsPrefsRequest,
  DeleteIdsPrefsResponseBuilder,
  Get3PCResponseBuilder,
  GetIdsPrefsRequest,
  GetIdsPrefsResponseBuilder,
  GetNewIdRequest,
  GetNewIdResponseBuilder,
  IdBuilder,
  Identifier,
  Identifiers,
  PostIdsPrefsRequest,
  PostIdsPrefsResponseBuilder,
  Preferences,
  RedirectDeleteIdsPrefsRequest,
  RedirectGetIdsPrefsRequest,
  RedirectPostIdsPrefsRequest,
  ReturnUrl,
  Test3Pc,
} from '@core/model';
import { Cookies, toTest3pcCookie, typedCookie } from '@core/cookies';
import { getTimeStampInSec } from '@core/timestamp';
import { jsonOperatorEndpoints, redirectEndpoints } from '@core/endpoints';
import { OperatorError, OperatorErrorType } from '@core/errors';
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api';
const tracer = opentelemetry.trace.getTracer('Operator');
/**
 * Expiration: now + 3 months
 */
const getOperatorExpiration = (date: Date = new Date()) => {
  const expirationDate = new Date(date);
  expirationDate.setMonth(expirationDate.getMonth() + 3);
  return expirationDate;
};

export enum Permission {
  READ = 'READ',
  WRITE = 'WRITE',
}

export type AllowedHosts = { [host: string]: Permission[] };

/**
 * The configuration of a operator node
 */
export interface OperatorNodeConfig extends Config {
  allowedHosts: AllowedHosts;
}

export class OperatorNode implements Node {
  constructor(
    identity: Omit<Identity, 'type'>,
    operatorHost: string,
    privateKey: string,
    allowedHosts: AllowedHosts,
    s2sOptions?: AxiosRequestConfig,
    public app: VHostApp = new VHostApp(identity.name, operatorHost)
  ) {
    // Note that CORS is "disabled" here because the check is done via signature
    // So accept whatever the referer is

    const keyStore = new PublicKeyStore(s2sOptions);
    const logger = new Log('Operator', 'black');

    // Start by adding identity endpoint FIXME there should be inheritance with IdentityNode
    addIdentityEndpoint(app.expressApp, {
      ...identity,
      type: 'operator',
    });

    const getIdsPrefsResponseBuilder = new GetIdsPrefsResponseBuilder(operatorHost, privateKey);
    const get3PCResponseBuilder = new Get3PCResponseBuilder();
    const postIdsPrefsResponseBuilder = new PostIdsPrefsResponseBuilder(operatorHost, privateKey);
    const getNewIdResponseBuilder = new GetNewIdResponseBuilder(operatorHost, privateKey);
    const deleteIdsPrefsResponseBuilder = new DeleteIdsPrefsResponseBuilder(operatorHost, privateKey);
    const idVerifier = new Verifier(keyStore.provider, new IdentifierDefinition());
    const prefsVerifier = new Verifier(keyStore.provider, new IdsAndPreferencesDefinition());

    const tld = getTopLevelDomain(operatorHost);

    const writeAsCookies = (input: PostIdsPrefsRequest, res: Response) => {
      if (input.body.identifiers !== undefined) {
        setCookie(res, Cookies.identifiers, JSON.stringify(input.body.identifiers), getOperatorExpiration(), {
          domain: tld,
        });
      }
      if (input.body.preferences !== undefined) {
        setCookie(res, Cookies.preferences, JSON.stringify(input.body.preferences), getOperatorExpiration(), {
          domain: tld,
        });
      }
    };

    const postIdsPrefsRequestVerifier = new RequestVerifier<PostIdsPrefsRequest>(
      keyStore.provider,
      new RequestWithBodyDefinition() // POST ids and prefs has body property
    );
    const getIdsPrefsRequestVerifier = new RequestVerifier(keyStore.provider, new RequestWithoutBodyDefinition());
    const getNewIdRequestVerifier = new RequestVerifier(keyStore.provider, new RequestWithoutBodyDefinition());
    const idBuilder = new IdBuilder(operatorHost, privateKey);

    const extractRequestAndContextFromHttp = <
      TopLevelRequestType,
      TopLevelRequestRedirectType extends { returnUrl: ReturnUrl; request: TopLevelRequestType }
    >(
      topLevelRequest: TopLevelRequestType | TopLevelRequestRedirectType,
      req: Request
    ) => {
      // Extract request from Redirect request, if needed
      let request: TopLevelRequestType;
      let context: RestContext | RedirectContext;
      if (
        (topLevelRequest as TopLevelRequestRedirectType).returnUrl &&
        (topLevelRequest as TopLevelRequestRedirectType).request
      ) {
        request = (topLevelRequest as TopLevelRequestRedirectType).request;
        context = {
          returnUrl: (topLevelRequest as TopLevelRequestRedirectType).returnUrl,
          referer: req.header('referer'),
        };
      } else {
        request = topLevelRequest as TopLevelRequestType;
        context = { origin: req.header('origin') };
      }

      return { request, context };
    };

    const getReadResponse = async (topLevelRequest: GetIdsPrefsRequest | RedirectGetIdsPrefsRequest, req: Request) => {
      const { request, context } = extractRequestAndContextFromHttp<GetIdsPrefsRequest, RedirectGetIdsPrefsRequest>(
        topLevelRequest,
        req
      );

      const sender = request.sender;

      if (!allowedHosts[sender]?.includes(Permission.READ)) {
        throw `Domain not allowed to read data: ${sender}`;
      }

      if (
        !(await getIdsPrefsRequestVerifier.verifySignatureAndContent(
          { request, context },
          sender, // sender will always be ok
          operatorHost // but operator needs to be verified
        ))
      ) {
        // TODO [errors] finer error feedback
        throw 'Read request verification failed';
      }

      const identifiers = typedCookie<Identifiers>(req.cookies[Cookies.identifiers]) ?? [];
      const preferences = typedCookie<Preferences>(req.cookies[Cookies.preferences]);

      if (!identifiers.some((i: Identifier) => i.type === 'paf_browser_id')) {
        // No existing id, let's generate one, unpersisted
        identifiers.push(idBuilder.generateNewId());
      }

      return getIdsPrefsResponseBuilder.buildResponse(sender, { identifiers, preferences });
    };

    const getWriteResponse = async (
      topLevelRequest: PostIdsPrefsRequest | RedirectPostIdsPrefsRequest,
      req: Request,
      res: Response
    ) => {
      const { request, context } = extractRequestAndContextFromHttp<PostIdsPrefsRequest, RedirectPostIdsPrefsRequest>(
        topLevelRequest,
        req
      );
      const sender = request.sender;

      if (!allowedHosts[sender]?.includes(Permission.WRITE)) {
        throw `Domain not allowed to write data: ${sender}`;
      }

      // Verify message
      if (
        !(await postIdsPrefsRequestVerifier.verifySignatureAndContent(
          { request, context },
          sender, // sender will always be ok
          operatorHost // but operator needs to be verified
        ))
      ) {
        // TODO [errors] finer error feedback
        throw 'Write request verification failed';
      }

      const { identifiers, preferences } = request.body;

      // because default value is true, we just remove it to save space
      identifiers[0].persisted = undefined;

      // Verify ids
      for (const id of identifiers) {
        if (!(await idVerifier.verifySignature(id))) {
          throw `Identifier verification failed for ${id.value}`;
        }
      }

      // Verify preferences FIXME optimization here: PAF_ID has already been verified in previous step
      if (!(await prefsVerifier.verifySignature(request.body))) {
        throw 'Preferences verification failed';
      }

      writeAsCookies(request, res);

      return postIdsPrefsResponseBuilder.buildResponse(sender, { identifiers, preferences });
    };

    const getDeleteResponse = async (
      input: DeleteIdsPrefsRequest | RedirectDeleteIdsPrefsRequest,
      req: Request,
      res: Response
    ) => {
      const { request, context } = extractRequestAndContextFromHttp<
        DeleteIdsPrefsRequest,
        RedirectDeleteIdsPrefsRequest
      >(input, req);
      const sender = request.sender;

      if (!allowedHosts[sender]?.includes(Permission.WRITE)) {
        throw `Domain not allowed to write data: ${sender}`;
      }

      // Verify message
      if (
        !(await getIdsPrefsRequestVerifier.verifySignatureAndContent(
          { request, context },
          sender, // sender will always be ok
          operatorHost // but operator needs to be verified
        ))
      ) {
        // TODO [errors] finer error feedback
        throw 'Delete request verification failed';
      }

      removeCookie(null, res, Cookies.identifiers, { domain: tld });
      removeCookie(null, res, Cookies.preferences, { domain: tld });

      res.status(204);
      return deleteIdsPrefsResponseBuilder.buildResponse(sender);
    };

    // *****************************************************************************************************************
    // ************************************************************************************************************ JSON
    // *****************************************************************************************************************
    const setTest3pcCookie = (res: Response) => {
      const now = new Date();
      const expirationDate = new Date(now);
      expirationDate.setTime(now.getTime() + 1000 * 60); // Lifespan: 1 minute
      const test3pc: Test3Pc = {
        timestamp: getTimeStampInSec(now),
      };
      setCookie(res, Cookies.test_3pc, toTest3pcCookie(test3pc), expirationDate, { domain: tld });
    };

    app.expressApp.get(jsonOperatorEndpoints.read, cors(corsOptionsAcceptAll), async (req, res) => {
      tracer.startActiveSpan('jsonOperatorEndpoints.read', async (span) => {
        logger.Info(jsonOperatorEndpoints.read);
        // Attempt to set a cookie (as 3PC), will be useful later if this call fails to get Prebid cookie values
        setTest3pcCookie(res);

        const request = getPafDataFromQueryString<GetIdsPrefsRequest>(req);

        try {
          const response = await getReadResponse(request, req);
          res.json(response);
        } catch (e) {
          logger.Error(jsonOperatorEndpoints.read, e);
          // FIXME finer error return
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
        span.end();
      });
    });

    app.expressApp.get(jsonOperatorEndpoints.verify3PC, cors(corsOptionsAcceptAll), (req, res) => {
      tracer.startActiveSpan('jsonOperatorEndpoints.verify3PC', async (span) => {
        logger.Info(jsonOperatorEndpoints.verify3PC);
        // Note: no signature verification here

        try {
          const cookies = req.cookies;
          const testCookieValue = typedCookie<Test3Pc>(cookies[Cookies.test_3pc]);

          // Clean up
          removeCookie(req, res, Cookies.test_3pc, { domain: tld });

          const response = get3PCResponseBuilder.buildResponse(testCookieValue);
          res.json(response);
        } catch (e) {
          logger.Error(jsonOperatorEndpoints.verify3PC, e);
          // FIXME finer error return
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
          span.recordException(e);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        span.end();
      });
    });

    app.expressApp.post(jsonOperatorEndpoints.write, cors(corsOptionsAcceptAll), async (req, res) => {
      logger.Info(jsonOperatorEndpoints.write);
      const input = getPayload<PostIdsPrefsRequest>(req);

      try {
        const signedData = await getWriteResponse(input, req, res);
        res.json(signedData);
      } catch (e) {
        logger.Error(jsonOperatorEndpoints.write, e);
        // FIXME finer error return
        const error: OperatorError = {
          type: OperatorErrorType.UNKNOWN_ERROR,
          details: '',
        };
        res.status(400);
        res.json(error);
      }
    });

    app.expressApp.options(jsonOperatorEndpoints.delete, cors(corsOptionsAcceptAll)); // enable pre-flight request for DELETE request
    app.expressApp.delete(jsonOperatorEndpoints.delete, cors(corsOptionsAcceptAll), async (req, res) => {
      logger.Info(jsonOperatorEndpoints.delete);
      const input = getPafDataFromQueryString<DeleteIdsPrefsRequest>(req);

      try {
        const response = await getDeleteResponse(input, req, res);
        res.json(response);
      } catch (e) {
        logger.Error(jsonOperatorEndpoints.delete, e);
        // FIXME finer error return
        const error: OperatorError = {
          type: OperatorErrorType.UNKNOWN_ERROR,
          details: '',
        };
        res.status(400);
        res.json(error);
      }
    });

    app.expressApp.get(jsonOperatorEndpoints.newId, cors(corsOptionsAcceptAll), async (req, res) => {
      tracer.startActiveSpan('jsonOperatorEndpoints.newId', async (span) => {
        logger.Info(jsonOperatorEndpoints.newId);
        const request = getPafDataFromQueryString<GetNewIdRequest>(req);
        const context = { origin: req.header('origin') };

        const sender = request.sender;

        if (!allowedHosts[sender]?.includes(Permission.READ)) {
          throw `Domain not allowed to read data: ${sender}`;
        }

        try {
          if (
            !(await getNewIdRequestVerifier.verifySignatureAndContent(
              { request, context },
              sender, // sender will always be ok
              operatorHost // but operator needs to be verified
            ))
          ) {
            // TODO [errors] finer error feedback
            throw 'New Id request verification failed';
          }

          const response = getNewIdResponseBuilder.buildResponse(request.receiver, idBuilder.generateNewId());
          res.json(response);
        } catch (e) {
          logger.Error(jsonOperatorEndpoints.newId, e);
          // FIXME finer error return
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
        span.end();
      });
    });

    // *****************************************************************************************************************
    // ******************************************************************************************************* REDIRECTS
    // *****************************************************************************************************************

    app.expressApp.get(redirectEndpoints.read, async (req, res) => {
      tracer.startActiveSpan('redirectEndpoints.read', async (span) => {
        logger.Info(redirectEndpoints.read);
        const request = getPafDataFromQueryString<RedirectGetIdsPrefsRequest>(req);

        if (!request?.returnUrl) {
          // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
          const error: OperatorError = {
            type: OperatorErrorType.INVALID_RETURN_URL,
            details: '',
          };
          res.status(400);
          res.json(error);
          return;
        }

        try {
          const response = await getReadResponse(request, req);

          const redirectResponse = getIdsPrefsResponseBuilder.toRedirectResponse(response, 200);
          const redirectUrl = getIdsPrefsResponseBuilder.getRedirectUrl(new URL(request?.returnUrl), redirectResponse);

          httpRedirect(res, redirectUrl.toString());
        } catch (e) {
          logger.Error(redirectEndpoints.read, e);
          // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
          // FIXME finer error return
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
        span.end();
      });
    });

    app.expressApp.get(redirectEndpoints.write, async (req, res) => {
      tracer.startActiveSpan('redirectEndpoints.write', async (span) => {
        logger.Info(redirectEndpoints.write);
        const request = getPafDataFromQueryString<RedirectPostIdsPrefsRequest>(req);

        if (!request?.returnUrl) {
          // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
          const error: OperatorError = {
            type: OperatorErrorType.INVALID_RETURN_URL,
            details: '',
          };
          res.status(400);
          res.json(error);
          return;
        }

        try {
          const response = await getWriteResponse(request, req, res);

          const redirectResponse = postIdsPrefsResponseBuilder.toRedirectResponse(response, 200);
          const redirectUrl = postIdsPrefsResponseBuilder.getRedirectUrl(new URL(request.returnUrl), redirectResponse);

          httpRedirect(res, redirectUrl.toString());
        } catch (e) {
          logger.Error(redirectEndpoints.write, e);
          // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
          // FIXME finer error return
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
        span.end();
      });
    });

    app.expressApp.get(redirectEndpoints.delete, async (req, res) => {
      tracer.startActiveSpan('redirectEndpoints.delete', async (span) => {
        logger.Info(redirectEndpoints.delete);
        const request = getPafDataFromQueryString<RedirectDeleteIdsPrefsRequest>(req);
        if (!request?.returnUrl) {
          // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
          const error: OperatorError = {
            type: OperatorErrorType.INVALID_RETURN_URL,
            details: '',
          };
          res.status(400);
          res.json(error);
          return;
        }
        try {
          const response = await getDeleteResponse(request, req, res);
          const redirectResponse = deleteIdsPrefsResponseBuilder.toRedirectResponse(response, 200);
          const redirectUrl = deleteIdsPrefsResponseBuilder.getRedirectUrl(
            new URL(request.returnUrl),
            redirectResponse
          );
          httpRedirect(res, redirectUrl.toString());
        } catch (e) {
          logger.Error(redirectEndpoints.delete, e);
          // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
          // FIXME finer error return
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
        span.end();
      });
    });
  }

  static async fromConfig(configPath: string, s2sOptions?: AxiosRequestConfig): Promise<OperatorNode> {
    const { host, identity, currentPrivateKey, allowedHosts } = (await parseConfig(configPath)) as OperatorNodeConfig;

    return new OperatorNode(identity, host, currentPrivateKey, allowedHosts, s2sOptions);
  }
}
