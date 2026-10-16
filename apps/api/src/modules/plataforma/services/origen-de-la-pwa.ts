/** Token de Nest para el origen de la PWA con que se arman los enlaces de invitación. */
export const ORIGEN_DE_LA_PWA = Symbol('ORIGEN_DE_LA_PWA');

/**
 * Lee `WEB_URL` al arrancar (SBA-19, D4). Sin ella, o con algo que no sea un
 * origen http(s), la API no sube: es mejor que un 500 al crear la primera
 * invitación. Devuelve el origen sin barra final.
 */
export function cargarOrigenDeLaPwa(entorno: NodeJS.ProcessEnv = process.env): string {
  const valor = entorno['WEB_URL']?.trim();
  if (!valor) throw new Error('Falta la variable de entorno WEB_URL, el origen de la PWA');

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('WEB_URL debe ser una URL válida, por ejemplo https://app.sigba.example');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('WEB_URL debe ser solo el origen http(s) de la PWA, sin ruta ni credenciales');
  }
  return url.origin;
}
