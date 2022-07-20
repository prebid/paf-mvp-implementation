import {
  Error,
  Get3PcResponse,
  GetIdentityResponse,
  GetIdsPrefsRequest,
  GetIdsPrefsResponse,
  GetNewIdRequest,
  GetNewIdResponse,
  Identifier,
  Identifiers,
  PostIdsPrefsRequest,
  PostIdsPrefsResponse,
  PostSignPreferencesRequest,
  Preferences,
  ProxyPostIdsPrefsResponse,
  RedirectGetIdsPrefsRequest,
  RedirectGetIdsPrefsResponse,
  RedirectPostIdsPrefsRequest,
  RedirectPostIdsPrefsResponse,
  Test3Pc,
} from '@core/model/generated-model';
import { toIdsCookie, toPrefsCookie, toTest3pcCookie } from '@core/cookies';
import { getTimeStampInSec } from '@core/timestamp';
import path from 'path';
import { OperatorClient } from '@client/operator-client';
import {
  Get3PCRequestBuilder,
  GetIdsPrefsRequestBuilder,
  GetNewIdRequestBuilder,
  PostIdsPrefsRequestBuilder,
} from '@core/model/operator-request-builders';
import {
  Get3PCResponseBuilder,
  GetIdsPrefsResponseBuilder,
  GetNewIdResponseBuilder,
  PostIdsPrefsResponseBuilder,
} from '@core/model/operator-response-builders';
import { Schema, Validator } from 'jsonschema';
import * as fs from 'fs';
import {
  ProxyRestSignPreferencesRequestBuilder,
  ProxyRestVerifyGetIdsPrefsRequestBuilder,
} from '@core/model/proxy-request-builders';
import isEqual from 'lodash.isequal';
import cloneDeep from 'lodash.clonedeep';
import { GetIdentityResponseBuilder } from '@core/model/identity-response-builder';
import { GetIdentityRequestBuilder } from '@core/model/identity-request-builder';
import { PublicKeyStore } from '@core/crypto/key-store';
import { parseConfig } from '@core/express/config';
import { IdBuilder } from '@core/model/id-builder';

const getTimestamp = (dateString: string) => getTimeStampInSec(new Date(dateString));
const getUrl = (method: 'POST' | 'GET', url: URL): string =>
  `${method} ${url.pathname}${url.search}\nHost: ${url.host}`;
const getGETUrl = (url: URL): string => getUrl('GET', url);
const getPOSTUrl = (url: URL): string => getUrl('POST', url);
const getRedirect = (url: URL): string => `303 ${url}`;

const fileExists = async (path: string) => {
  // the result can be either false (from the caught error) or it can be an fs.stats object
  const result = await fs.promises.stat(path).catch((err) => {
    if (err.code === 'ENOENT') {
      return false;
    }
    throw err;
  });

  return result !== false;
};

// Remove undefined properties
// Other options are super verbose (ex: https://stackoverflow.com/questions/30812765/how-to-remove-undefined-and-null-values-from-an-object-using-lodash)
const deepRemoveUndefined = <T>(object: T): T => JSON.parse(JSON.stringify(object));

if (!(process.argv[2]?.length > 0)) {
  const scriptName = path.basename(__filename);
  console.error(`Usage: ts-node -r tsconfig-paths/register ${scriptName} <outputDir>
Example: ts-node -r tsconfig-paths/register ${scriptName} ../../../addressable-network-proposals/mvp-spec/partials`);
  process.exit(1);
}

const outputDir = path.join(process.cwd(), process.argv[2]);

if (!fs.existsSync(outputDir)) {
  throw `Output dir not found: "${outputDir}"`;
}

const configPath = path.join(__dirname, '..', 'configs');

// The examples are not supposed to look like a demo but a real environment
const publisherHost = 'cmp.com';
const advertiserHost = 'advertiser.com';

class Examples {
  // **************************** Main data
  unpersistedIdJson: Identifier = undefined;
  idJson: Identifier = undefined;
  preferencesJson: Preferences = undefined;

  // **************************** Cookies
  // JSON version
  ['ids_cookie-prettyJson']: Identifiers;
  // Stringified version
  ids_cookieTxt: string;

  // JSON version
  ['preferences_cookie-prettyJson']: Preferences;
  // Stringified version
  preferences_cookieTxt: string;

  // JSON version
  ['test_3pc_cookie-prettyJson']: Test3Pc;
  // Stringified version
  test_3pc_cookieTxt: string;

  // **************************** Read
  getIdsPrefsRequestJson: GetIdsPrefsRequest = undefined;
  getIdsPrefsRequestHttp: string;

  getIdsPrefsResponse_knownJson: GetIdsPrefsResponse = undefined;
  getIdsPrefsResponse_unknownJson: GetIdsPrefsResponse = undefined;

  redirectGetIdsPrefsRequestJson: RedirectGetIdsPrefsRequest = undefined;
  redirectGetIdsPrefsRequestHttp: string;

  redirectGetIdsPrefsResponse_knownJson: RedirectGetIdsPrefsResponse = undefined;
  redirectGetIdsPrefsResponse_knownTxt: string;
  redirectGetIdsPrefsResponse_unknownJson: RedirectGetIdsPrefsResponse = undefined;
  redirectGetIdsPrefsResponse_unknownTxt: string;

  // **************************** Write
  postIdsPrefsRequestJson: PostIdsPrefsRequest = undefined;
  postIdsPrefsRequestHttp: string;

  postIdsPrefsResponseJson: PostIdsPrefsResponse = undefined;

  redirectPostIdsPrefsRequestJson: RedirectPostIdsPrefsRequest = undefined;
  redirectPostIdsPrefsRequestHttp: string;
  redirectPostIdsPrefsResponseJson: RedirectPostIdsPrefsResponse = undefined;
  redirectPostIdsPrefsResponseTxt: string;

  // **************************** Get new ID
  getNewIdRequestJson: GetNewIdRequest = undefined;
  getNewIdRequestHttp: string;

  getNewIdResponseJson: GetNewIdResponse = undefined;

  // **************************** Verify 3PC
  get3pcRequestHttp: string;
  get3pcResponse_supportedJson: Get3PcResponse = undefined;
  get3pcResponse_unsupportedJson: Error = undefined;

  // **************************** Identity
  getIdentityRequest_operatorHttp: string;
  getIdentityResponse_operatorJson: GetIdentityResponse = undefined;

  getIdentityRequest_cmpHttp: string;
  getIdentityResponse_cmpJson: GetIdentityResponse = undefined;

  // **************************** Proxy
  signPreferencesHttp: string;
  signPreferencesJson: PostSignPreferencesRequest = undefined;
  proxyPostIdsPrefsResponseJson: ProxyPostIdsPrefsResponse = undefined;
  verifyGetIdsPrefsHttp: string;
  verifyGetIdsPrefs_invalidJson: Error = undefined;

  constructor(protected outputDir: string) {}

  protected async buildExamples() {
    // The examples are not supposed to look like a demo but a real environment
    const operatorConfigPath = path.join(configPath, 'crto-poc-1-operator/config.json');
    const crtoOneOperatorConfig = await parseConfig(operatorConfigPath);
    crtoOneOperatorConfig.host = 'operator.paf-operation-domain.io';
    const operatorPrivateKey = crtoOneOperatorConfig.currentPrivateKey;

    const clientNodeConfigPath = path.join(configPath, 'pafpublisher-client/config.json');
    const clientNodeConfig = await parseConfig(clientNodeConfigPath);
    const clientNodePrivateKey = clientNodeConfig.currentPrivateKey;

    const keyStore = new PublicKeyStore();
    const idBuilder = new IdBuilder(crtoOneOperatorConfig.host, operatorPrivateKey);
    const originalAdvertiserUrl = new URL(
      `https://${advertiserHost}/news/2022/02/07/something-crazy-happened?utm_content=campaign%20content`
    );

    // **************************** Main data
    this.setObject('unpersistedIdJson', {
      persisted: false,
      ...idBuilder.signId('2e71121a-4feb-4a34-b7d1-839587d36390', getTimestamp('2022/01/24 17:19')),
    });
    this.setObject(
      'idJson',
      idBuilder.signId('7435313e-caee-4889-8ad7-0acd0114ae3c', getTimestamp('2022/01/18 12:13'))
    );

    const cmpClient = new OperatorClient(crtoOneOperatorConfig.host, publisherHost, clientNodePrivateKey, keyStore);
    this.setObject(
      'preferencesJson',
      cmpClient.buildPreferences(
        [this.idJson],
        { use_browsing_for_personalization: true },
        getTimestamp('2022/01/18 12:16')
      )
    );

    // **************************** Cookies
    this['ids_cookie-prettyJson'] = [this.idJson];
    this.ids_cookieTxt = toIdsCookie(this['ids_cookie-prettyJson']);

    this['preferences_cookie-prettyJson'] = this.preferencesJson;
    this.preferences_cookieTxt = toPrefsCookie(this['preferences_cookie-prettyJson']);

    this['test_3pc_cookie-prettyJson'] = {
      timestamp: getTimestamp('2022/01/26 17:24'),
    };
    this.test_3pc_cookieTxt = toTest3pcCookie(this['test_3pc_cookie-prettyJson']);

    // **************************** Read
    const getIdsPrefsRequestBuilder = new GetIdsPrefsRequestBuilder(
      crtoOneOperatorConfig.host,
      publisherHost,
      clientNodePrivateKey
    );
    const getIdsPrefsResponseBuilder = new GetIdsPrefsResponseBuilder(crtoOneOperatorConfig.host, clientNodePrivateKey);
    this.setRestMessage(
      'getIdsPrefsRequestJson',
      getIdsPrefsRequestBuilder.buildRestRequest(
        { origin: originalAdvertiserUrl.toString() },
        undefined,
        getTimestamp('2022/01/24 17:19')
      )
    );
    this.getIdsPrefsRequestHttp = getGETUrl(getIdsPrefsRequestBuilder.getRestUrl(this.getIdsPrefsRequestJson));
    this.setRestMessage(
      'getIdsPrefsResponse_knownJson',
      getIdsPrefsResponseBuilder.buildResponse(
        advertiserHost,
        {
          identifiers: [this.idJson],
          preferences: this.preferencesJson,
        },
        getTimestamp('2022/01/24 17:19:10')
      )
    );
    this.setRestMessage(
      'getIdsPrefsResponse_unknownJson',
      getIdsPrefsResponseBuilder.buildResponse(
        advertiserHost,
        {
          identifiers: [this.unpersistedIdJson],
        },
        getTimestamp('2022/01/24 17:19:10')
      )
    );

    this.setRedirectRequest(
      'redirectGetIdsPrefsRequestJson',
      getIdsPrefsRequestBuilder.buildRedirectRequest(
        { referer: originalAdvertiserUrl.toString(), returnUrl: originalAdvertiserUrl.toString() },
        undefined,
        getTimestamp('2022/01/24 17:19')
      )
    );
    this.redirectGetIdsPrefsRequestHttp = getGETUrl(
      getIdsPrefsRequestBuilder.getRedirectUrl(this.redirectGetIdsPrefsRequestJson)
    );

    this.redirectGetIdsPrefsResponse_knownJson = getIdsPrefsResponseBuilder.toRedirectResponse(
      this.getIdsPrefsResponse_knownJson,
      200
    );
    this.redirectGetIdsPrefsResponse_knownTxt = getRedirect(
      getIdsPrefsResponseBuilder.getRedirectUrl(originalAdvertiserUrl, this.redirectGetIdsPrefsResponse_knownJson)
    );
    this.redirectGetIdsPrefsResponse_unknownJson = getIdsPrefsResponseBuilder.toRedirectResponse(
      this.getIdsPrefsResponse_unknownJson,
      200
    );
    this.redirectGetIdsPrefsResponse_unknownTxt = getRedirect(
      getIdsPrefsResponseBuilder.getRedirectUrl(originalAdvertiserUrl, this.redirectGetIdsPrefsResponse_unknownJson)
    );

    // **************************** Write
    const postIdsPrefsRequestBuilder = new PostIdsPrefsRequestBuilder(
      crtoOneOperatorConfig.host,
      publisherHost,
      clientNodePrivateKey
    );
    const postIdsPrefsResponseBuilder = new PostIdsPrefsResponseBuilder(
      crtoOneOperatorConfig.host,
      clientNodePrivateKey
    );
    const postIdsPrefsRequest = postIdsPrefsRequestBuilder.buildRestRequest(
      { origin: originalAdvertiserUrl.toString() },
      {
        identifiers: [this.idJson],
        preferences: this.preferencesJson,
      },
      getTimestamp('2022/01/25 09:01')
    );
    this.setRestMessage('postIdsPrefsRequestJson', postIdsPrefsRequest);
    this.postIdsPrefsRequestHttp = getPOSTUrl(postIdsPrefsRequestBuilder.getRestUrl()); // Notice is POST url
    this.setRestMessage(
      'postIdsPrefsResponseJson',
      postIdsPrefsResponseBuilder.buildResponse(
        publisherHost,
        {
          identifiers: [this.idJson],
          preferences: this.preferencesJson,
        },
        getTimestamp('2022/01/25 09:01:03')
      )
    );

    this.setRedirectRequest(
      'redirectPostIdsPrefsRequestJson',
      postIdsPrefsRequestBuilder.buildRedirectRequest(
        { referer: originalAdvertiserUrl.toString(), returnUrl: originalAdvertiserUrl.toString() },
        {
          identifiers: [this.idJson],
          preferences: this.preferencesJson,
        },
        getTimestamp('2022/01/25 09:01')
      )
    );
    this.redirectPostIdsPrefsRequestHttp = getGETUrl(
      postIdsPrefsRequestBuilder.getRedirectUrl(this.redirectPostIdsPrefsRequestJson)
    );
    this.redirectPostIdsPrefsResponseJson = postIdsPrefsResponseBuilder.toRedirectResponse(
      this.postIdsPrefsResponseJson,
      200
    );
    this.redirectPostIdsPrefsResponseTxt = getRedirect(
      postIdsPrefsResponseBuilder.getRedirectUrl(originalAdvertiserUrl, this.redirectPostIdsPrefsResponseJson)
    );

    // **************************** Get new ID
    const getNewIdRequestBuilder = new GetNewIdRequestBuilder(
      crtoOneOperatorConfig.host,
      publisherHost,
      clientNodePrivateKey
    );
    const getNewIdResponseBuilder = new GetNewIdResponseBuilder(crtoOneOperatorConfig.host, operatorPrivateKey);
    this.setRestMessage(
      'getNewIdRequestJson',
      getNewIdRequestBuilder.buildRestRequest(
        { origin: originalAdvertiserUrl.toString() },
        getTimestamp('2022/03/01 19:04')
      )
    );
    this.getNewIdRequestHttp = getGETUrl(getNewIdRequestBuilder.getRestUrl(this.getNewIdRequestJson));

    this.setRestMessage(
      'getNewIdResponseJson',
      getNewIdResponseBuilder.buildResponse(publisherHost, this.unpersistedIdJson, getTimestamp('2022/03/01 19:04:47'))
    );

    // **************************** Verify 3PC
    const get3PCRequestBuilder = new Get3PCRequestBuilder(crtoOneOperatorConfig.host);
    const get3PCResponseBuilder = new Get3PCResponseBuilder();
    this.get3pcRequestHttp = getGETUrl(get3PCRequestBuilder.getRestUrl());

    this.get3pcResponse_supportedJson = get3PCResponseBuilder.buildResponse(
      this['test_3pc_cookie-prettyJson']
    ) as Get3PcResponse;
    this.get3pcResponse_unsupportedJson = get3PCResponseBuilder.buildResponse(undefined) as Error;

    // **************************** Identity
    const getIdentityRequestBuilder_operator = new GetIdentityRequestBuilder(crtoOneOperatorConfig.host);
    const getIdentityResponseBuilder_operator = new GetIdentityResponseBuilder(
      crtoOneOperatorConfig.identity.name,
      'operator',
      crtoOneOperatorConfig.identity.dpoEmailAddress,
      new URL(crtoOneOperatorConfig.identity.privacyPolicyUrl)
    );
    this.getIdentityRequest_operatorHttp = getGETUrl(getIdentityRequestBuilder_operator.getRestUrl(undefined));
    this.getIdentityResponse_operatorJson = getIdentityResponseBuilder_operator.buildResponse(
      crtoOneOperatorConfig.identity.publicKeys
    );

    // TODO add examples with multiple keys
    const getIdentityRequestBuilder_cmp = new GetIdentityRequestBuilder(publisherHost);
    const getIdentityResponseBuilder_cmp = new GetIdentityResponseBuilder(
      clientNodeConfig.identity.name,
      'vendor',
      clientNodeConfig.identity.dpoEmailAddress,
      new URL(clientNodeConfig.identity.privacyPolicyUrl)
    );
    this.getIdentityRequest_cmpHttp = getGETUrl(getIdentityRequestBuilder_cmp.getRestUrl(undefined));
    this.getIdentityResponse_cmpJson = getIdentityResponseBuilder_cmp.buildResponse(
      clientNodeConfig.identity.publicKeys
    );

    // **************************** Proxy
    const signPreferencesRequestBuilder = new ProxyRestSignPreferencesRequestBuilder(publisherHost);
    this.signPreferencesHttp = getPOSTUrl(signPreferencesRequestBuilder.getRestUrl(undefined)); // Notice is POST url
    this.signPreferencesJson = signPreferencesRequestBuilder.buildRequest([this.idJson], {
      use_browsing_for_personalization: true,
    });

    this.proxyPostIdsPrefsResponseJson = {
      url: postIdsPrefsRequestBuilder.getRestUrl().toString(),
      payload: postIdsPrefsRequest,
    };

    const verifyGetIdsPrefsRequestBuilder = new ProxyRestVerifyGetIdsPrefsRequestBuilder(publisherHost);
    this.verifyGetIdsPrefsHttp = getPOSTUrl(verifyGetIdsPrefsRequestBuilder.getRestUrl(undefined)); // Notice is POST url
    this.verifyGetIdsPrefs_invalidJson = { message: 'Invalid signature' };
  }

  private setObject<T extends { source: U }, U extends { signature: string }>(keyName: keyof Examples, newValue: T) {
    const dict = this.getObjectAsDict();

    const oldValue = dict[keyName] as T;
    dict[keyName] = newValue;

    (dict[keyName] as T).source.signature = Examples.getSignature(oldValue, newValue, Examples.extractSourceSignature);
  }

  private setRedirectRequest<T extends { request: U }, U extends { signature: string }>(
    keyName: keyof Examples,
    newValue: T
  ) {
    const dict = this.getObjectAsDict();

    const oldValue = dict[keyName] as T;
    dict[keyName] = newValue;

    (dict[keyName] as T).request.signature = Examples.getSignature(
      oldValue,
      newValue,
      Examples.extractRequestSignature
    );
  }

  private setRestMessage<T extends { signature: string }>(keyName: keyof Examples, newValue: T) {
    const dict = this.getObjectAsDict();

    const oldValue = dict[keyName] as T;
    dict[keyName] = newValue;

    (dict[keyName] as T).signature = Examples.getSignature(oldValue, newValue, Examples.extractSignature);
  }

  private static extractSignature<T extends { signature: string }>(valueWithSignature: T) {
    const value = cloneDeep(valueWithSignature);
    const signature = value.signature;
    value.signature = undefined;

    return { signature, value };
  }

  private static extractRequestSignature<T extends { request: U }, U extends { signature: string }>(
    valueWithSignature: T
  ) {
    const value = cloneDeep(valueWithSignature);
    const signature = value.request.signature;
    value.request.signature = undefined;

    return { signature, value };
  }

  private static extractSourceSignature<T extends { source: U }, U extends { signature: string }>(
    valueWithSignature: T
  ) {
    const value = cloneDeep(valueWithSignature);
    const signature = value.source.signature;
    value.source.signature = undefined;

    return { signature, value };
  }

  private static getSignature<T>(
    oldValue: T,
    newValue: T,
    extractSignature: (value: T) => { signature: string; value: T }
  ) {
    const newExtract = extractSignature(newValue);

    if (oldValue !== undefined) {
      const oldExtract = extractSignature(oldValue);

      const equal = isEqual(deepRemoveUndefined(oldExtract.value), deepRemoveUndefined(newExtract.value));

      if (equal) {
        // Old and new value are equal, appart on the signature property
        // This means we can keep the old signature
        return oldExtract.signature;
      }
      console.log('objects are different:');
      console.log(JSON.stringify(oldExtract.value, null, 2));
      console.log(JSON.stringify(newExtract.value, null, 2));
    }
    // Keep new signature if data is different
    return newExtract.signature;
  }

  async updateFiles() {
    await this.loadExistingFiles();

    await this.buildExamples();

    const dict = this.getObjectAsDict();
    for (const key of Object.keys(this)) {
      let baseName: string;
      let fileBody: string;
      if (key.endsWith('Json')) {
        baseName = `${key.replace(/Json$/, '')}.json`;
        fileBody = JSON.stringify(dict[key], null, 2);
      } else if (key.endsWith('Txt')) {
        baseName = `${key.replace(/Txt$/, '')}.txt`;
        fileBody = dict[key] as string;
      } else if (key.endsWith('Http')) {
        baseName = `${key.replace(/Http$/, '')}.http`;
        fileBody = dict[key] as string;
      } else {
        continue;
      }

      const fullPath = path.join(this.outputDir, baseName);
      console.log(fullPath);
      await fs.promises.writeFile(fullPath, fileBody);
    }
  }

  private getObjectAsDict() {
    return this as unknown as { [typeName: string]: unknown };
  }

  private async loadExistingFiles() {
    const dict = this.getObjectAsDict();
    for (const key of Object.keys(this)) {
      // Search for a pre-existing file with the right name.
      // If it exists, load its content into the corresponding key of this object
      if (key.endsWith('Json')) {
        const baseName = `${key.replace(/Json$/, '')}.json`;
        const fullPath = path.join(this.outputDir, baseName);

        if (await fileExists(fullPath)) {
          dict[key] = JSON.parse((await fs.promises.readFile(fullPath)).toString());
        }
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class SchemasValidator {
  private v = new Validator();
  private schemas: { [id: string]: unknown } = {};

  async initValidator(): Promise<this> {
    // FIXME use a parameter to validate examples. Or ignore validation
    const inputDir = path.join(__dirname, '..', '..', 'paf-mvp-core-js', 'json-schemas');
    const files = await fs.promises.readdir(inputDir);
    const schemas = await Promise.all(
      files.map(async (f: string) => JSON.parse(await fs.promises.readFile(path.join(inputDir, f), 'utf-8')))
    );

    schemas.forEach((schema: Schema) => {
      this.v.addSchema(schema, schema.$id);
      this.schemas[schema.$id] = schema;
    });

    return this;
  }

  validate(examples: Examples): this {
    // TODO map each example with its schema
    this.v.validate(examples.idJson, this.schemas['identifier']);

    return this;
  }
}

(async () => {
  const examples = new Examples(outputDir);

  // TODO activate validation
  /*
    const validator = await new SchemasValidator().initValidator();
    validator.validate(examples)
     */

  await examples.updateFiles();
})();
