import {
  AuthenticationExtensionsClientInputs,
  AuthenticationExtensionsClientOutputs,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationCredential,
} from '@simplewebauthn/typescript-types';
import { generateCustomError } from '../helpers/__jest__/generateCustomError';
import { browserSupportsWebAuthn } from '../helpers/browserSupportsWebAuthn';
import { bufferToBase64URLString } from '../helpers/bufferToBase64URLString';
import { WebAuthnError } from '../helpers/webAuthnError';
import { webauthnAbortService } from '../helpers/webAuthnAbortService';

import { utf8StringToBuffer } from '../helpers/utf8StringToBuffer';

import { startRegistration } from './startRegistration';

jest.mock('../helpers/browserSupportsWebAuthn');

const mockNavigatorCreate = window.navigator.credentials.create as jest.Mock;
const mockSupportsWebauthn = browserSupportsWebAuthn as jest.Mock;

const mockAttestationObject = 'mockAtte';
const mockClientDataJSON = 'mockClie';

const goodOpts1: PublicKeyCredentialCreationOptionsJSON = {
  challenge: bufferToBase64URLString(utf8StringToBuffer('fizz')),
  attestation: 'direct',
  pubKeyCredParams: [
    {
      alg: -7,
      type: 'public-key',
    },
  ],
  rp: {
    id: 'simplewebauthn.dev',
    name: 'SimpleWebAuthn',
  },
  user: {
    id: '5678',
    displayName: 'username',
    name: 'username',
  },
  timeout: 1,
  excludeCredentials: [
    {
      id: 'C0VGlvYFratUdAV1iCw-ULpUW8E-exHPXQChBfyVeJZCMfjMFcwDmOFgoMUz39LoMtCJUBW8WPlLkGT6q8qTCg',
      type: 'public-key',
      transports: ['internal'],
    },
  ],
};

beforeEach(() => {
  // Stub out a response so the method won't throw
  mockNavigatorCreate.mockImplementation((): Promise<any> => {
    return new Promise(resolve => {
      resolve({ response: {}, getClientExtensionResults: () => ({}) });
    });
  });

  mockSupportsWebauthn.mockReturnValue(true);

  // Reset the abort service so we get an accurate call count
  // @ts-ignore
  webauthnAbortService.controller = undefined;
});

afterEach(() => {
  mockNavigatorCreate.mockReset();
  mockSupportsWebauthn.mockReset();
});

test('should convert options before passing to navigator.credentials.create(...)', async () => {
  await startRegistration(goodOpts1);

  const argsPublicKey = mockNavigatorCreate.mock.calls[0][0].publicKey;
  const credId = argsPublicKey.excludeCredentials[0].id;

  // Make sure challenge and user.id are converted to Buffers
  expect(new Uint8Array(argsPublicKey.challenge)).toEqual(new Uint8Array([102, 105, 122, 122]));
  expect(new Uint8Array(argsPublicKey.user.id)).toEqual(new Uint8Array([53, 54, 55, 56]));

  // Confirm construction of excludeCredentials array
  expect(credId instanceof ArrayBuffer).toEqual(true);
  expect(credId.byteLength).toEqual(64);
  expect(argsPublicKey.excludeCredentials[0].type).toEqual('public-key');
  expect(argsPublicKey.excludeCredentials[0].transports).toEqual(['internal']);
});

test('should return base64url-encoded response values', async () => {
  mockNavigatorCreate.mockImplementation((): Promise<RegistrationCredential> => {
    return new Promise(resolve => {
      resolve({
        id: 'foobar',
        rawId: utf8StringToBuffer('foobar'),
        response: {
          attestationObject: Buffer.from(mockAttestationObject, 'ascii'),
          clientDataJSON: Buffer.from(mockClientDataJSON, 'ascii'),
          getTransports: () => [],
          getAuthenticatorData: () => new Uint8Array(),
          getPublicKey: () => null,
          getPublicKeyAlgorithm: () => -999,
        },
        getClientExtensionResults: () => ({}),
        type: 'public-key',
        authenticatorAttachment: '',
      });
    });
  });

  const response = await startRegistration(goodOpts1);

  expect(response.rawId).toEqual('Zm9vYmFy');
  expect(response.response.attestationObject).toEqual('bW9ja0F0dGU');
  expect(response.response.clientDataJSON).toEqual('bW9ja0NsaWU');
});

test("should throw error if WebAuthn isn't supported", async () => {
  mockSupportsWebauthn.mockReturnValue(false);

  await expect(startRegistration(goodOpts1)).rejects.toThrow(
    'WebAuthn is not supported in this browser',
  );
});

test('should throw error if attestation is cancelled for some reason', async () => {
  mockNavigatorCreate.mockImplementation((): Promise<null> => {
    return new Promise(resolve => {
      resolve(null);
    });
  });

  await expect(startRegistration(goodOpts1)).rejects.toThrow('Registration was not completed');
});

test('should send extensions to authenticator if present in options', async () => {
  const extensions: AuthenticationExtensionsClientInputs = {
    credProps: true,
    appid: 'appidHere',
    // @ts-ignore
    uvm: true,
    // @ts-ignore
    appidExclude: 'appidExcludeHere',
  };
  const optsWithExts: PublicKeyCredentialCreationOptionsJSON = {
    ...goodOpts1,
    extensions,
  };
  await startRegistration(optsWithExts);

  const argsExtensions = mockNavigatorCreate.mock.calls[0][0].publicKey.extensions;

  expect(argsExtensions).toEqual(extensions);
});

test('should not set any extensions if not present in options', async () => {
  await startRegistration(goodOpts1);

  const argsExtensions = mockNavigatorCreate.mock.calls[0][0].publicKey.extensions;

  expect(argsExtensions).toEqual(undefined);
});

test('should include extension results', async () => {
  const extResults: AuthenticationExtensionsClientOutputs = {
    appid: true,
    credProps: {
      rk: true,
    },
  };

  // Mock extension return values from authenticator
  mockNavigatorCreate.mockImplementation((): Promise<any> => {
    return new Promise(resolve => {
      resolve({ response: {}, getClientExtensionResults: () => extResults });
    });
  });

  // Extensions aren't present in this object, but it doesn't matter since we're faking the response
  const response = await startRegistration(goodOpts1);

  expect(response.clientExtensionResults).toEqual(extResults);
});

test('should include extension results when no extensions specified', async () => {
  const response = await startRegistration(goodOpts1);

  expect(response.clientExtensionResults).toEqual({});
});

test('should support "cable" transport in excludeCredentials', async () => {
  const opts: PublicKeyCredentialCreationOptionsJSON = {
    ...goodOpts1,
    excludeCredentials: [
      {
        ...goodOpts1.excludeCredentials![0],
        transports: ['cable'],
      },
    ],
  };

  await startRegistration(opts);

  expect(
    mockNavigatorCreate.mock.calls[0][0].publicKey.excludeCredentials[0].transports[0],
  ).toEqual('cable');
});

test('should return "cable" transport from response', async () => {
  mockNavigatorCreate.mockResolvedValue({
    id: 'foobar',
    rawId: utf8StringToBuffer('foobar'),
    response: {
      attestationObject: Buffer.from(mockAttestationObject, 'ascii'),
      clientDataJSON: Buffer.from(mockClientDataJSON, 'ascii'),
      getTransports: () => ['cable'],
    },
    getClientExtensionResults: () => ({}),
    type: 'webauthn.create',
  });

  const regResponse = await startRegistration(goodOpts1);

  expect(regResponse.response.transports).toEqual(['cable']);
});

test('should cancel an existing call when executed again', async () => {
  const abortSpy = jest.spyOn(AbortController.prototype, 'abort');

  // Fire off a request and immediately attempt a second one
  startRegistration(goodOpts1);
  await startRegistration(goodOpts1);
  expect(abortSpy).toHaveBeenCalledTimes(1);
});

test('should return authenticatorAttachment if present', async () => {
  // Mock extension return values from authenticator
  mockNavigatorCreate.mockImplementation((): Promise<any> => {
    return new Promise(resolve => {
      resolve({
        response: {},
        getClientExtensionResults: () => { },
        authenticatorAttachment: 'cross-platform',
      });
    });
  });

  const response = await startRegistration(goodOpts1);

  expect(response.authenticatorAttachment).toEqual('cross-platform');
});

describe('WebAuthnError', () => {
  describe('AbortError', () => {
    const AbortError = generateCustomError('AbortError');
    /**
     * We can't actually test this because nothing in startRegistration() propagates the abort
     * signal. But if you invoked WebAuthn via this and then manually sent an abort signal I guess
     * this will catch.
     *
     * As a matter of fact I couldn't actually get any browser to respect the abort signal...
     */
    test.skip('should identify abort signal', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(AbortError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/abort signal/i);
      rejected.toThrow(/AbortError/);
      rejected.toHaveProperty('code', 'ERROR_CEREMONY_ABORTED');
      rejected.toHaveProperty('cause', AbortError);
    });
  });

  describe('ConstraintError', () => {
    const ConstraintError = generateCustomError('ConstraintError');

    test('should identify unsupported discoverable credentials', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(ConstraintError);

      const opts: PublicKeyCredentialCreationOptionsJSON = {
        ...goodOpts1,
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
        },
      };

      const rejected = await expect(startRegistration(opts)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/discoverable credentials were required/i);
      rejected.toThrow(/no available authenticator supported/i);
      rejected.toHaveProperty('name', 'ConstraintError');
      rejected.toHaveProperty('code', 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT');
      rejected.toHaveProperty('cause', ConstraintError);
    });

    test('should identify unsupported user verification', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(ConstraintError);

      const opts: PublicKeyCredentialCreationOptionsJSON = {
        ...goodOpts1,
        authenticatorSelection: {
          userVerification: 'required',
        },
      };

      const rejected = await expect(startRegistration(opts)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/user verification was required/i);
      rejected.toThrow(/no available authenticator supported/i);
      rejected.toHaveProperty('name', 'ConstraintError');
      rejected.toHaveProperty('code', 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT');
      rejected.toHaveProperty('cause', ConstraintError);
    });
  });

  describe('InvalidStateError', () => {
    const InvalidStateError = generateCustomError('InvalidStateError');

    test('should identify re-registration attempt', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(InvalidStateError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/authenticator/i);
      rejected.toThrow(/previously registered/i);
      rejected.toHaveProperty('name', 'InvalidStateError');
      rejected.toHaveProperty('code', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED');
      rejected.toHaveProperty('cause', InvalidStateError);
    });
  });

  describe('NotAllowedError', () => {
    test('should pass through error message (iOS Safari - Operation failed)', async () => {
      /**
       * Thrown when biometric is not enrolled, or a Safari bug prevents conditional UI from being
       * aborted properly between page reloads.
       *
       * See https://github.com/MasterKale/SimpleWebAuthn/discussions/350#discussioncomment-4896572
       */
      const NotAllowedError = generateCustomError('NotAllowedError', 'Operation failed.');
      mockNavigatorCreate.mockRejectedValueOnce(NotAllowedError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrow(Error);
      rejected.toThrow(/operation failed/i);
      rejected.toHaveProperty('name', 'NotAllowedError');
      rejected.toHaveProperty('code', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY');
      rejected.toHaveProperty('cause', NotAllowedError);
    });

    test('should pass through error message (Chrome M110 - Bad TLS Cert)', async () => {
      /**
       * Starting from Chrome M110, WebAuthn is blocked if the site is being displayed on a URL with
       * TLS certificate issues. This includes during development.
       *
       * See https://github.com/MasterKale/SimpleWebAuthn/discussions/351#discussioncomment-4910458
       */
      const NotAllowedError = generateCustomError(
        'NotAllowedError',
        'WebAuthn is not supported on sites with TLS certificate errors.'
      );
      mockNavigatorCreate.mockRejectedValueOnce(NotAllowedError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrow(Error);
      rejected.toThrow(/sites with TLS certificate errors/i);
      rejected.toHaveProperty('name', 'NotAllowedError');
      rejected.toHaveProperty('code', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY');
      rejected.toHaveProperty('cause', NotAllowedError);
    });
  });

  describe('NotSupportedError', () => {
    const NotSupportedError = generateCustomError('NotSupportedError');

    test('should identify missing "public-key" entries in pubKeyCredParams', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(NotSupportedError);

      const opts = {
        ...goodOpts1,
        pubKeyCredParams: [],
      };

      const rejected = await expect(startRegistration(opts)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/pubKeyCredParams/i);
      rejected.toThrow(/public-key/i);
      rejected.toHaveProperty('name', 'NotSupportedError');
      rejected.toHaveProperty('code', 'ERROR_MALFORMED_PUBKEYCREDPARAMS');
      rejected.toHaveProperty('cause', NotSupportedError);
    });

    test('should identify no authenticator supports algs in pubKeyCredParams', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(NotSupportedError);

      const opts: PublicKeyCredentialCreationOptionsJSON = {
        ...goodOpts1,
        pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      };

      const rejected = await expect(startRegistration(opts)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/No available authenticator/i);
      rejected.toThrow(/pubKeyCredParams/i);
      rejected.toHaveProperty('name', 'NotSupportedError');
      rejected.toHaveProperty('code', 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG');
      rejected.toHaveProperty('cause', NotSupportedError);
    });
  });

  describe('SecurityError', () => {
    const SecurityError = generateCustomError('SecurityError');

    let _originalHostName: string;

    beforeEach(() => {
      _originalHostName = window.location.hostname;
    });

    afterEach(() => {
      window.location.hostname = _originalHostName;
    });

    test('should identify invalid domain', async () => {
      window.location.hostname = '1.2.3.4';

      mockNavigatorCreate.mockRejectedValueOnce(SecurityError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrowError(WebAuthnError);
      rejected.toThrow(/1\.2\.3\.4/);
      rejected.toThrow(/invalid domain/i);
      rejected.toHaveProperty('name', 'SecurityError');
      rejected.toHaveProperty('code', 'ERROR_INVALID_DOMAIN');
      rejected.toHaveProperty('cause', SecurityError);
    });

    test('should identify invalid RP ID', async () => {
      window.location.hostname = 'simplewebauthn.com';

      mockNavigatorCreate.mockRejectedValueOnce(SecurityError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrowError(WebAuthnError);
      rejected.toThrow(goodOpts1.rp.id);
      rejected.toThrow(/invalid for this domain/i);
      rejected.toHaveProperty('name', 'SecurityError');
      rejected.toHaveProperty('code', 'ERROR_INVALID_RP_ID');
      rejected.toHaveProperty('cause', SecurityError);
    });
  });

  describe('TypeError', () => {
    test('should identify malformed user ID', async () => {
      const typeError = new TypeError('user id is bad');
      mockNavigatorCreate.mockRejectedValueOnce(typeError);

      const opts = {
        ...goodOpts1,
        user: {
          ...goodOpts1.user,
          id: Array(65).fill('a').join(''),
        },
      };

      const rejected = await expect(startRegistration(opts)).rejects;
      rejected.toThrowError(WebAuthnError);
      rejected.toThrow(/user id/i);
      rejected.toThrow(/not between 1 and 64 characters/i);
      rejected.toHaveProperty('name', 'TypeError');
      rejected.toHaveProperty('code', 'ERROR_INVALID_USER_ID_LENGTH');
      rejected.toHaveProperty('cause', typeError);
    });
  });

  describe('UnknownError', () => {
    const UnknownError = generateCustomError('UnknownError');

    test('should identify potential authenticator issues', async () => {
      mockNavigatorCreate.mockRejectedValueOnce(UnknownError);

      const rejected = await expect(startRegistration(goodOpts1)).rejects;
      rejected.toThrow(WebAuthnError);
      rejected.toThrow(/authenticator/i);
      rejected.toThrow(/unable to process the specified options/i);
      rejected.toThrow(/could not create a new credential/i);
      rejected.toHaveProperty('name', 'UnknownError');
      rejected.toHaveProperty('code', 'ERROR_AUTHENTICATOR_GENERAL_ERROR');
      rejected.toHaveProperty('cause', UnknownError);
    });
  });
});
