import { v4 as uuidv4 } from 'uuid';
import { getTimeStampInSec } from '@core/timestamp';
import { Identifier } from '@core/model/generated-model';
import { UnsignedSource } from '@core/model/model';
import { ISigner, Signer } from '@core/crypto/signer';
import { privateKeyFromString } from '@core/crypto/keys';
import { IdentifierDefinition } from '@core/crypto/signing-definition';

export class IdBuilder {
  constructor(
    public host: string,
    privateKey: string,
    private readonly idSigner: ISigner<UnsignedSource<Identifier>> = new Signer(
      privateKeyFromString(privateKey),
      new IdentifierDefinition()
    )
  ) {}

  generateNewId(timestamp = getTimeStampInSec()): Identifier {
    // Generate new UUID value
    const pseudonymousId = uuidv4();

    return {
      ...this.signId(pseudonymousId, timestamp),
      persisted: false,
    };
  }

  signId(value: string, timestampInSec = getTimeStampInSec()): Identifier {
    const unsignedId: UnsignedSource<Identifier> = {
      version: '0.1',
      type: 'paf_browser_id',
      value,
      source: {
        domain: this.host,
        timestamp: timestampInSec,
      },
    };
    const { source, ...rest } = unsignedId;

    return {
      ...rest,
      source: {
        ...source,
        signature: this.idSigner.sign(unsignedId),
      },
    };
  }
}
