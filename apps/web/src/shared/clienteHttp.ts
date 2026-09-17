/**
 * Cliente HTTP contra la API de SIGBA. Punto único donde se añaden el token y
 * el manejo de errores, para que ninguna feature hable con `fetch` directo.
 *
 * El token de Auth0 se mantiene en memoria, no en almacenamiento persistente
 * (ADR-06). La reautenticación al sincronizar llega con SBA-8.
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

export async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      'content-type': 'application/json',
      ...opciones.headers,
    },
  });

  if (!respuesta.ok) {
    throw new ErrorDeApi(respuesta.status, `La API respondió ${respuesta.status}`);
  }

  return (await respuesta.json()) as T;
}
