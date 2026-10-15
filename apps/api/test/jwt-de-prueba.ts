import { createSign, generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';

/**
 * Emisor de JWT sintético para pruebas HTTP con los guards reales: un JWKS
 * local y tokens RS256 firmados con una llave efímera.
 */
export const EMISOR_DE_PRUEBA = 'https://prueba.sigba/';
export const AUDIENCIA_DE_PRUEBA = 'https://api.prueba.sigba/';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'synthetic-test-key';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

export function firmarToken(sub: string): string {
  const ahora = Math.floor(Date.now() / 1000);
  const codificar = (valor: object) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  const entrada = `${codificar({ alg: 'RS256', typ: 'JWT', kid: KID })}.${codificar({
    iss: EMISOR_DE_PRUEBA,
    aud: AUDIENCIA_DE_PRUEBA,
    sub,
    iat: ahora,
    exp: ahora + 300,
  })}`;
  const firma = createSign('RSA-SHA256').update(entrada).sign(privateKey);
  return `${entrada}.${firma.toString('base64url')}`;
}

/** Abre el JWKS en un puerto libre; devuelve su URL y cómo cerrarlo. */
export async function abrirJwks(): Promise<{ jwksUri: string; cerrar: () => Promise<void> }> {
  const servidor: Server = createServer((peticion, respuesta) => {
    if (peticion.url !== '/.well-known/jwks.json') {
      respuesta.writeHead(404).end();
      return;
    }
    respuesta.writeHead(200, { 'content-type': 'application/json' });
    respuesta.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  const direccion = servidor.address();
  if (!direccion || typeof direccion === 'string') throw new Error('No se abrió el JWKS local');

  return {
    jwksUri: `http://127.0.0.1:${direccion.port}/.well-known/jwks.json`,
    cerrar: () => new Promise<void>((listo) => servidor.close(() => listo())),
  };
}
