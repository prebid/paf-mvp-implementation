import { Request, Response } from 'express';
import cors, { CorsOptions } from 'cors';
import { OperatorClient } from './operator-client';
import {
  DeleteIdsPrefsRequestBuilder,
  Get3PCRequestBuilder,
  GetNewIdRequestBuilder,
  IdsAndPreferences,
  PostIdsPrefsRequestBuilder,
  PostSeedRequest,
  PostSeedResponse,
  PostSignPreferencesRequest,
  ProxyPostIdsPrefsResponse,
  RedirectGetIdsPrefsResponse,
} from '@core/model';
import { jsonProxyEndpoints, proxyUriParams, redirectProxyEndpoints } from '@core/endpoints';
import {
  addIdentityEndpoint,
  Config,
  escapeRegExp,
  getPayload,
  getTopLevelDomain,
  Node,
  parseConfig,
  VHostApp,
} from '@core/express';
import { fromDataToObject } from '@core/query-string';
import { AxiosRequestConfig } from 'axios';
import { PublicKeyStore } from '@core/crypto/key-store';
import { Log } from '@core/log';
import { ClientNodeError, ClientNodeErrorType, OperatorError, OperatorErrorType } from '@core/errors';

// TODO remove this automatic status return and do it explicitely outside of this method
const getMandatoryQueryStringParam = (req: Request, res: Response, paramName: string): string | undefined => {
  const stringValue = req.query[paramName] as string;
  if (stringValue === undefined) {
    res.sendStatus(400); // TODO add message
    return undefined;
  }
  return stringValue;
};

/**
 * Get return URL parameter, otherwise set response code 400
 * @param req
 * @param res
 */
const getReturnUrl = (req: Request, res: Response): URL | undefined => {
  const redirectStr = getMandatoryQueryStringParam(req, res, proxyUriParams.returnUrl);
  return redirectStr ? new URL(redirectStr) : undefined;
};

/**
 * Get request parameter, otherwise set response code 400
 * @param req
 * @param res
 */
const getMessageObject = <T>(req: Request, res: Response): T => {
  const requestStr = getMandatoryQueryStringParam(req, res, proxyUriParams.message);
  return requestStr ? (JSON.parse(requestStr) as T) : undefined;
};

/**
 * The configuration of a OneKey client Node
 */
export interface ClientNodeConfig extends Config {
  operatorHost: string;
}

export class ClientNode implements Node {
  /**
   * Add OneKey client node endpoints to an Express app
   * @param config
   * @param app the Express app
   *   hostName: the OneKey client host name
   *   privateKey: the OneKey client private key string
   * @param s2sOptions? [optional] server to server configuration for local dev
   */
  constructor(
    config: ClientNodeConfig,
    s2sOptions?: AxiosRequestConfig,
    public app = new VHostApp(config.identity.name, config.host)
  ) {
    const { identity, currentPrivateKey } = config;
    const hostName = config.host;
    const operatorHost = config.operatorHost;

    // Start by adding identity endpoint FIXME inheritence with IdentityNode
    addIdentityEndpoint(app.expressApp, {
      ...identity,
      type: 'vendor',
    });
    const logger = new Log('Client node', '#bbb');
    const client = new OperatorClient(operatorHost, hostName, currentPrivateKey, new PublicKeyStore(s2sOptions));

    // FIXME class attributes
    const postIdsPrefsRequestBuilder = new PostIdsPrefsRequestBuilder(operatorHost, hostName, currentPrivateKey);
    const get3PCRequestBuilder = new Get3PCRequestBuilder(operatorHost);
    const getNewIdRequestBuilder = new GetNewIdRequestBuilder(operatorHost, hostName, currentPrivateKey);
    const deleteIdsPrefsRequestBuilder = new DeleteIdsPrefsRequestBuilder(operatorHost, hostName, currentPrivateKey);

    const tld = getTopLevelDomain(hostName);

    // Only allow calls from the same TLD+1, under HTTPS
    const allowedOrigins: RegExp[] = [
      new RegExp(
        `^https:\\/\\/(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-]*[a-zA-Z0-9])\\.)*${escapeRegExp(tld)}(/?$|\\/.*$)`
      ),
    ];

    const isValidOrigin = (origin: string) => allowedOrigins.findIndex((regexp: RegExp) => regexp.test(origin)) !== -1;

    const checkOrigin = (endpoint: string) => (req: Request, res: Response, next: () => unknown) => {
      const origin = req.header('origin');

      if (isValidOrigin(origin)) {
        next();
      } else {
        const error: ClientNodeError = {
          type: ClientNodeErrorType.INVALID_ORIGIN,
          details: `Origin is not allowed: ${origin}`,
        };
        logger.Error(endpoint, error);
        res.status(400);
        res.json(error);
      }
    };

    const checkReferer = (endpoint: string) => (req: Request, res: Response, next: () => unknown) => {
      const referer = req.header('referer');

      if (isValidOrigin(referer)) {
        next();
      } else {
        const error: ClientNodeError = {
          type: ClientNodeErrorType.INVALID_REFERER,
          details: `Referer is not allowed: ${referer}`,
        };
        logger.Error(endpoint, error);
        res.status(400);
        res.json(error);
      }
    };

    const corsOptions: CorsOptions = {
      origin: allowedOrigins,
      optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
      credentials: true,
      allowedHeaders: ['Content-Type'],
    };
    // FIXME methods for each endpoint

    // *****************************************************************************************************************
    // ************************************************************************************************************ JSON
    // *****************************************************************************************************************

    app.expressApp.get(jsonProxyEndpoints.read, cors(corsOptions), checkOrigin(jsonProxyEndpoints.read), (req, res) => {
      logger.Info(jsonProxyEndpoints.read);

      try {
        const url = client.getReadRestUrl(req);
        res.send(url.toString());
      } catch (e) {
        logger.Error(jsonProxyEndpoints.read, e);
        const error: ClientNodeError = {
          type: ClientNodeErrorType.UNKNOWN_ERROR,
          details: '',
        };
        res.status(400);
        res.json(error);
      }
    });

    app.expressApp.post(
      jsonProxyEndpoints.write,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.write),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.write);
        try {
          const unsignedRequest = getPayload<IdsAndPreferences>(req);
          const signedPayload = postIdsPrefsRequestBuilder.buildRestRequest(
            { origin: req.header('origin') },
            unsignedRequest
          );

          const url = postIdsPrefsRequestBuilder.getRestUrl();
          // Return both the signed payload and the url to call
          const response: ProxyPostIdsPrefsResponse = {
            payload: signedPayload,
            url: url.toString(),
          };
          res.json(response);
        } catch (e) {
          logger.Error(jsonProxyEndpoints.write, e);
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    app.expressApp.get(
      jsonProxyEndpoints.verify3PC,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.verify3PC),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.verify3PC);

        try {
          const url = get3PCRequestBuilder.getRestUrl();
          res.send(url.toString());
        } catch (e) {
          logger.Error(jsonProxyEndpoints.verify3PC, e);
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    app.expressApp.get(
      jsonProxyEndpoints.newId,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.newId),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.newId);
        try {
          const getNewIdRequestJson = getNewIdRequestBuilder.buildRestRequest({ origin: req.header('origin') });
          const url = getNewIdRequestBuilder.getRestUrl(getNewIdRequestJson);

          res.send(url.toString());
        } catch (e) {
          logger.Error(jsonProxyEndpoints.newId, e);
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    app.expressApp.options(jsonProxyEndpoints.delete, cors(corsOptions)); // enable pre-flight request for DELETE request
    app.expressApp.delete(
      jsonProxyEndpoints.delete,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.delete),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.delete);

        try {
          const request = deleteIdsPrefsRequestBuilder.buildRestRequest({ origin: req.header('origin') });
          const url = deleteIdsPrefsRequestBuilder.getRestUrl(request);
          res.send(url.toString());
        } catch (e) {
          logger.Error(jsonProxyEndpoints.delete, e);
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    // *****************************************************************************************************************
    // ******************************************************************************************************* REDIRECTS
    // *****************************************************************************************************************
    const checkReturnUrl = (endpoint: string) => (req: Request, res: Response, next: () => unknown) => {
      const returnUrl = getReturnUrl(req, res);

      if (isValidOrigin(returnUrl.toString())) {
        next();
      } else {
        const error: ClientNodeError = {
          type: ClientNodeErrorType.INVALID_RETURN_URL,
          details: `Invalid return URL: ${returnUrl.toString()}`,
        };
        logger.Error(endpoint, error);
        res.status(400);
        res.json(error);
      }
    };

    app.expressApp.get(
      redirectProxyEndpoints.read,
      cors(corsOptions),
      checkReferer(redirectProxyEndpoints.read),
      checkReturnUrl(redirectProxyEndpoints.read),
      (req, res) => {
        logger.Info(redirectProxyEndpoints.read);

        const returnUrl = getReturnUrl(req, res);

        try {
          const url = client.getReadRedirectUrl(req, returnUrl);
          res.send(url.toString());
        } catch (e) {
          logger.Error(redirectProxyEndpoints.read, e);
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    app.expressApp.get(
      redirectProxyEndpoints.write,
      cors(corsOptions),
      checkReferer(redirectProxyEndpoints.write),
      checkReturnUrl(redirectProxyEndpoints.write),
      (req, res) => {
        logger.Info(redirectProxyEndpoints.write);
        const returnUrl = getReturnUrl(req, res);
        const input = getMessageObject<IdsAndPreferences>(req, res);

        if (input) {
          try {
            const postIdsPrefsRequestJson = postIdsPrefsRequestBuilder.buildRedirectRequest(
              {
                returnUrl: returnUrl.toString(),
                referer: req.header('referer'),
              },
              input
            );

            const url = postIdsPrefsRequestBuilder.getRedirectUrl(postIdsPrefsRequestJson);
            res.send(url.toString());
          } catch (e) {
            logger.Error(redirectProxyEndpoints.write, e);
            // FIXME more robust error handling: websites should not be broken in this case, do a redirect with empty data
            const error: ClientNodeError = {
              type: ClientNodeErrorType.UNKNOWN_ERROR,
              details: '',
            };
            res.status(400);
            res.json(error);
          }
        }
      }
    );

    app.expressApp.get(
      redirectProxyEndpoints.delete,
      cors(corsOptions),
      checkReferer(redirectProxyEndpoints.delete),
      checkReturnUrl(redirectProxyEndpoints.delete),
      (req, res) => {
        logger.Info(redirectProxyEndpoints.delete);

        const returnUrl = getReturnUrl(req, res);

        try {
          const url = client.getDeleteRedirectUrl(req, returnUrl);
          res.send(url.toString());
        } catch (e) {
          logger.Error(redirectProxyEndpoints.delete, e);
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    // *****************************************************************************************************************
    // ******************************************************************************************** JSON - SIGN & VERIFY
    // *****************************************************************************************************************
    app.expressApp.post(
      jsonProxyEndpoints.verifyRead,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.verifyRead),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.verifyRead);
        const message = fromDataToObject<RedirectGetIdsPrefsResponse>(req.body);

        if (!message.response) {
          logger.Error(jsonProxyEndpoints.verifyRead, message.error);
          // FIXME do something smart in case of error
          const error: OperatorError = {
            type: OperatorErrorType.UNKNOWN_ERROR,
            details: message.error.message, // TODO should be improved
          };
          res.status(400);
          res.json(error);
          return;
        }

        try {
          const verification = client.verifyReadResponse(message.response);
          if (!verification) {
            // TODO [errors] finer error feedback
            const error: ClientNodeError = {
              type: ClientNodeErrorType.VERIFICATION_FAILED,
              details: '',
            };
            logger.Error(jsonProxyEndpoints.verifyRead, error);
            res.status(400);
            res.json(error);
          } else {
            res.json(message.response);
          }
        } catch (e) {
          logger.Error(jsonProxyEndpoints.verifyRead, e);
          // FIXME finer error return
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    app.expressApp.post(
      jsonProxyEndpoints.signPrefs,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.signPrefs),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.signPrefs);
        try {
          const { identifiers, unsignedPreferences } = getPayload<PostSignPreferencesRequest>(req);
          res.json(client.buildPreferences(identifiers, unsignedPreferences.data));
        } catch (e) {
          logger.Error(jsonProxyEndpoints.signPrefs, e);
          // FIXME finer error return
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );

    // *****************************************************************************************************************
    // ***************************************************************************************************** JSON - SEED
    // *****************************************************************************************************************

    app.expressApp.post(
      jsonProxyEndpoints.createSeed,
      cors(corsOptions),
      checkOrigin(jsonProxyEndpoints.createSeed),
      (req, res) => {
        logger.Info(jsonProxyEndpoints.createSeed);
        try {
          const request = JSON.parse(req.body as string) as PostSeedRequest;
          const seed = client.buildSeed(request.transaction_ids, request.data);
          const response = seed as PostSeedResponse; // For now, the response is only a Seed.
          res.json(response);
        } catch (e) {
          logger.Error(jsonProxyEndpoints.createSeed, e);
          // FIXME finer error return
          const error: ClientNodeError = {
            type: ClientNodeErrorType.UNKNOWN_ERROR,
            details: '',
          };
          res.status(400);
          res.json(error);
        }
      }
    );
  }

  static async fromConfig(configPath: string, s2sOptions?: AxiosRequestConfig): Promise<ClientNode> {
    const config = (await parseConfig(configPath)) as ClientNodeConfig;

    return new ClientNode(config, s2sOptions);
  }
}
