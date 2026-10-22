import { useAuth0 } from '@auth0/auth0-react';
import { createContext, useCallback, useContext } from 'react';
import { CABECERAS, type Rol } from '@sigba/shared-types';
import { useEstadoReautenticacion } from './reautenticacion.ts';
import { ErrorDeApi, pedir, pedirConEtag } from './clienteHttp.ts';

/**
 * Con qué rol, banco e institución actúa la persona en esta sesión
 * (Arquitectura 8.2). Vive en memoria, como el token (ADR-06).
 *
 * `null` mientras no hay banco elegido. La llena `SesionProvider` (app/).
 */
export interface AsignacionActiva {
  rol: Rol;
  bancoId: string | null;
  institucionId: string | null;
}

export const SesionContext = createContext<AsignacionActiva | null>(null);

export function useAsignacion(): AsignacionActiva | null {
  return useContext(SesionContext);
}

/** Si la asignación activa es de uno de esos roles. Sin sesión, nunca. */
export function tieneRol(asignacion: AsignacionActiva | null, roles: readonly Rol[]): boolean {
  return asignacion !== null && roles.includes(asignacion.rol);
}

/** Las cabeceras de quien llama, más el banco y la institución de la sesión que no traigan. */
function cabecerasDe(asignacion: AsignacionActiva | null, propias?: HeadersInit): Headers {
  const cabeceras = new Headers(propias);
  if (asignacion?.bancoId && !cabeceras.has(CABECERAS.banco)) {
    cabeceras.set(CABECERAS.banco, asignacion.bancoId);
  }
  if (asignacion?.institucionId && !cabeceras.has(CABECERAS.institucion)) {
    cabeceras.set(CABECERAS.institucion, asignacion.institucionId);
  }
  return cabeceras;
}

/** Si el error dice que la sesión venció: 401 de la API o Auth0 pidiendo iniciar sesión. */
export function pideIniciarSesion(error: unknown): boolean {
  if (error instanceof ErrorDeApi) return error.estado === 401;
  const codigoAuth0 =
    typeof error === 'object' && error !== null && 'error' in error ? error.error : undefined;
  return (
    typeof codigoAuth0 === 'string' &&
    ['login_required', 'consent_required', 'missing_refresh_token', 'invalid_grant'].includes(
      codigoAuth0,
    )
  );
}

/** Las dos formas de llamar a la API; las dos reciben el token al final. */
type Llamada<R> = (ruta: string, opciones: RequestInit, accessToken?: string) => Promise<R>;

/**
 * Token, cabeceras de la sesión y aviso de reautenticación alrededor de una
 * llamada a la API. Lo comparten `usePedir` y `usePedirConEtag`.
 */
function useLlamadaConSesion() {
  const asignacion = useAsignacion();
  const { getAccessTokenSilently } = useAuth0();
  const { marcarRequerido } = useEstadoReautenticacion();

  return useCallback(
    async <R>(llamada: Llamada<R>, ruta: string, opciones: RequestInit): Promise<R> => {
      try {
        const accessToken = await getAccessTokenSilently();
        marcarRequerido(false);
        return await llamada(
          ruta,
          { ...opciones, headers: cabecerasDe(asignacion, opciones.headers) },
          accessToken,
        );
      } catch (error) {
        marcarRequerido(pideIniciarSesion(error));
        throw error;
      }
    },
    [asignacion, getAccessTokenSilently, marcarRequerido],
  );
}

/**
 * `pedir` con el banco y la institución de la sesión en las cabeceras, que es
 * con lo que la API elige la asignación. Las features usan este y no `pedir`.
 */
export function usePedir() {
  const llamar = useLlamadaConSesion();
  return useCallback(
    <T>(ruta: string, opciones: RequestInit = {}) => llamar(pedir<T>, ruta, opciones),
    [llamar],
  );
}

/** Igual que `usePedir`, para las rutas con ETag: devuelve el estado y el ETag. */
export function usePedirConEtag() {
  const llamar = useLlamadaConSesion();
  return useCallback(
    <T>(ruta: string, opciones: RequestInit = {}) => llamar(pedirConEtag<T>, ruta, opciones),
    [llamar],
  );
}
