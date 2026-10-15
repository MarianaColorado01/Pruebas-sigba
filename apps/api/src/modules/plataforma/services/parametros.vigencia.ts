import { isDeepStrictEqual } from 'node:util';
import { ConflictoDeVigencia, type ParametroVersion } from './parametros.repositorio.js';

export type Escritura = 'devolver' | 'corregir' | 'crear';

/**
 * Decide qué hace un PUT de parámetro. Las escrituras administrativas no llevan
 * `comandoId`: su idempotencia es natural, por fecha de inicio.
 *
 * - Ya existe una versión con esa fecha de inicio y el mismo valor: se devuelve
 *   esa versión, sin escribir (reintento del cliente).
 * - Existe con otro valor y su vigencia aún no empieza (`fechaInicio > hoy`):
 *   se corrige el valor en esa misma versión. Es el único caso de edición.
 * - Existe con otro valor y ya empezó (hoy o antes): 409. Una versión vigente
 *   o pasada no se edita; se corrige creando una versión nueva hacia adelante.
 * - No existe: se crea, siempre que no sea anterior a hoy ni a la última versión.
 */
export function decidirEscritura(
  valor: unknown,
  fechaInicio: string,
  hoy: string,
  versiones: { conEsaFecha: ParametroVersion | null; ultima: ParametroVersion | null },
): Escritura {
  const { conEsaFecha, ultima } = versiones;
  if (conEsaFecha) {
    if (isDeepStrictEqual(conEsaFecha.valor, valor)) return 'devolver';
    if (fechaInicio > hoy) return 'corregir';
    throw new ConflictoDeVigencia(
      'Esa vigencia ya empezó con otro valor. Para cambiarlo, crea una versión con fecha posterior.',
    );
  }
  if (fechaInicio < hoy || (ultima && fechaInicio < ultima.fechaInicio)) {
    throw new ConflictoDeVigencia();
  }
  return 'crear';
}
