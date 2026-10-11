import { createHmac, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth0TokenVerifier } from './auth0-token-verifier.js';

const issuer = 'https://sigba-synthetic.us.auth0.com/';
const audience = 'https://api.sigba.synthetic';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'synthetic-key',
  use: 'sig',
  alg: 'RS256',
};

let server: Server;
let jwksUri: string;

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function token(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT', kid: 'synthetic-key' },
): string {
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    iss: issuer,
    aud: audience,
    sub: 'auth0|synthetic-user',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  };
}

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url !== '/.well-known/jwks.json') {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: [jwk] }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se abrió el JWKS local');
  jwksUri = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('Auth0TokenVerifier', () => {
  const verifier = () => new Auth0TokenVerifier({ issuer, audience, jwksUri });

  it('acepta un access token RS256 de la API y expone sub más issuer', async () => {
    await expect(verifier().verify(token(claims()))).resolves.toEqual({
      auth0Sub: 'auth0|synthetic-user',
      emisor: issuer,
    });
  });

  it.each([
    ['expirado', claims({ exp: Math.floor(Date.now() / 1000) - 1 })],
    ['sin exp', claims({ exp: undefined })],
    ['otra audiencia', claims({ aud: 'https://api.other.synthetic' })],
    ['otro emisor', claims({ iss: 'https://other.synthetic/' })],
    ['ID token dirigido al cliente SPA', claims({ aud: 'synthetic-spa-client-id' })],
  ])('rechaza token %s', async (_description, payload) => {
    await expect(verifier().verify(token(payload))).rejects.toThrow();
  });

  it('rechaza una firma alterada', async () => {
    const valid = token(claims());
    const [header, payload, encodedSignature] = valid.split('.');
    const signature = Buffer.from(encodedSignature!, 'base64url');
    signature[0] = signature[0]! ^ 0xff;

    await expect(
      verifier().verify(`${header}.${payload}.${signature.toString('base64url')}`),
    ).rejects.toThrow();
  });

  it('rechaza alg:none y HS256', async () => {
    const payload = base64Url(JSON.stringify(claims()));
    const unsigned = `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${payload}.`;
    const input = `${base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${payload}`;
    const hmac = createHmac('sha256', 'synthetic-secret').update(input).digest('base64url');

    await expect(verifier().verify(unsigned)).rejects.toThrow();
    await expect(verifier().verify(`${input}.${hmac}`)).rejects.toThrow();
  });
});
