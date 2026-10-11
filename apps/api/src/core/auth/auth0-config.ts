export interface Auth0Config {
  issuer: string;
  audience: string;
  /** Las pruebas apuntan a un JWKS local; la API lo deriva del issuer. */
  jwksUri: string;
}

function requerida(entorno: NodeJS.ProcessEnv, nombre: string): string {
  const valor = entorno[nombre]?.trim();
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

export function cargarConfiguracionAuth0(entorno: NodeJS.ProcessEnv = process.env): Auth0Config {
  const issuer = requerida(entorno, 'AUTH0_ISSUER_URL');
  const audience = requerida(entorno, 'AUTH0_AUDIENCE');

  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new Error('AUTH0_ISSUER_URL debe ser una URL válida');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(
      'AUTH0_ISSUER_URL debe ser una URL HTTPS sin credenciales, consulta ni fragmento',
    );
  }

  // Auth0 firma `iss` con barra final y jose lo compara carácter a carácter.
  const conBarra = issuer.endsWith('/') ? issuer : `${issuer}/`;
  return { issuer: conBarra, audience, jwksUri: new URL('.well-known/jwks.json', conBarra).href };
}
