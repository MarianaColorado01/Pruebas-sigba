import { uuidv7 } from '@/offline/uuidv7.ts';
import type { ComandoDeSalida, Salida } from '@/shared/salidas.ts';

type Pedir = <T>(ruta: string, opciones?: RequestInit) => Promise<T>;

/**
 * Arma el comando con sus ids de cliente. Se llama una vez por salida: un
 * reintento manda el mismo comando, y la API devuelve lo que ya quedó.
 */
export function nuevoComandoDeSalida(
  datos: Omit<ComandoDeSalida, 'comandoId' | 'detalles'> & {
    detalles: Omit<ComandoDeSalida['detalles'][number], 'movimientoId'>[];
  },
): ComandoDeSalida {
  return {
    ...datos,
    comandoId: uuidv7(),
    detalles: datos.detalles.map((detalle) => ({ ...detalle, movimientoId: uuidv7() })),
  };
}

/**
 * El único camino por el que una salida llega a la API. Hoy va en línea; la
 * cola sin señal (ADR-10) envuelve esta función sin tocar la pantalla.
 */
export function registrarSalida(pedir: Pedir, comando: ComandoDeSalida): Promise<Salida> {
  return pedir<Salida>('/salidas', { method: 'POST', body: JSON.stringify(comando) });
}
