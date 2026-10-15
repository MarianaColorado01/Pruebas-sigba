/**
 * Cliente HTTP contra la API de SIGBA. Punto único donde se añaden el token y
 * el manejo de errores, para que ninguna feature hable con `fetch` directo.
 *
 * El token de Auth0 se mantiene en memoria, no en almacenamiento persistente
 * (ADR-06).
 */

const BASE = import.meta.env['VITE_API_URL'] ?? '/api/v1';

export class ErrorDeApi extends Error {
  readonly estado: number;

  constructor(estado: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDeApi';
    this.estado = estado;
  }
}

/** Lo que responde una ruta con ETag: 304 llega sin datos. */
export type RespuestaConEtag<T> =
  { estado: 200; etag: string | null; datos: T } | { estado: 304; etag: string | null };

async function llamar(
  ruta: string,
  opciones: RequestInit,
  accessToken: string | undefined,
): Promise<Response> {
  // Con spread, un `Headers` llega vacío y un arreglo de pares llega como una
  // cabecera «0»; `new Headers()` lee las tres formas de `HeadersInit`.
  const headers = new Headers(opciones.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const respuesta = await fetch(`${BASE}${ruta}`, { ...opciones, headers });

  if (!respuesta.ok && respuesta.status !== 304) {
    throw new ErrorDeApi(respuesta.status, `La API respondió ${respuesta.status}`);
  }
  return respuesta;
}

export async function pedir<T>(
  ruta: string,
  opciones: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const respuesta = await llamar(ruta, opciones, accessToken);
  // Sin If-None-Match la API no responde 304; si lo hiciera, no hay cuerpo que leer.
  if (respuesta.status === 304) throw new ErrorDeApi(304, 'La API respondió 304 sin ETag');
  // Un exportable llega como CSV; todo lo demás, como JSON.
  if (respuesta.headers.get('content-type')?.startsWith('text/csv')) {
    return (await respuesta.text()) as T;
  }
  return (await respuesta.json()) as T;
}

/**
 * Para las rutas que versionan su contenido con ETag, como el catálogo: quien
 * llama manda `If-None-Match` y recibe 304 si su copia sigue vigente.
 */
export async function pedirConEtag<T>(
  ruta: string,
  opciones: RequestInit = {},
  accessToken?: string,
): Promise<RespuestaConEtag<T>> {
  const respuesta = await llamar(ruta, opciones, accessToken);
  const etag = respuesta.headers.get('etag');
  if (respuesta.status === 304) return { estado: 304, etag };
  return { estado: 200, etag, datos: (await respuesta.json()) as T };
}
