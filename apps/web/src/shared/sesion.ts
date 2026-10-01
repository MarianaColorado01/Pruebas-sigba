import { createContext, useCallback, useContext } from 'react';
import { CABECERAS, type Rol } from '@sigba/shared-types';
import { pedir } from './clienteHttp.ts';

/**
 * Con qué rol, banco e institución actúa la persona en esta sesión
 * (Arquitectura 8.2). Vive en memoria, como el token (ADR-06).
 *
 * `null` mientras no hay sesión. La llena el inicio de sesión de SBA-8.
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

/**
 * `pedir` con el banco y la institución de la sesión en las cabeceras, que es
 * con lo que la API elige la asignación. Las features usan este y no `pedir`.
 */
export function usePedir() {
  const asignacion = useAsignacion();

  return useCallback(
    <T>(ruta: string, opciones: RequestInit = {}) =>
      pedir<T>(ruta, { ...opciones, headers: cabecerasDe(asignacion, opciones.headers) }),
    [asignacion],
  );
}
