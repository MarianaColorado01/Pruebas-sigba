import { useCallback } from 'react';
import { usePedir } from '@/shared/sesion.ts';

export const ORIGENES = ['propia', 'abaco', 'plataforma'] as const;
export type Origen = (typeof ORIGENES)[number];

export const NOVEDADES = ['roto', 'reempacado', 'no_apto'] as const;
export type Novedad = (typeof NOVEDADES)[number];

/**
 * Lo que la pantalla manda a `POST /recepciones` (SBA-24). `comandoId` y cada
 * `movimientoId` son UUIDv7 del celular: reenviar el mismo comando no duplica
 * inventario (Arquitectura 6.1).
 */
export interface ComandoDeRecepcion {
  comandoId: string;
  donanteId: string;
  origen: Origen;
  bodegaId: string;
  detalles: {
    movimientoId: string;
    referenciaId: string;
    /** Con punto decimal. */
    cantidad: string;
    lote: string | null;
    /** AAAA-MM-DD, o nulo si el producto no trae fecha. */
    vencimiento: string | null;
    novedad: Novedad | null;
  }[];
}

/** Lo que responde la API al confirmar. */
export interface RecepcionConfirmada {
  id: string;
  donanteId: string;
  origen: Origen;
  bodegaId: string;
  registradaEn: string;
  detalles: {
    movimientoId: string;
    referenciaId: string;
    loteId: string;
    cantidad: string;
    kilos: string;
    lote: string | null;
    vencimiento: string | null;
    novedad: Novedad | null;
    /** Sin precio vigente aprobado queda pendiente, nunca en cero (ADR-13). */
    valoracion: 'pendiente' | 'con_precio';
  }[];
}

/**
 * `pendiente`: el comando quedó guardado en el celular y todavía no lo
 * confirmó la API. Hoy solo sale `confirmada`; la cola sin señal (ADR-10)
 * devuelve `pendiente` cuando envuelva esta función.
 */
export type ResultadoDeRecepcion =
  { estado: 'confirmada'; recepcion: RecepcionConfirmada } | { estado: 'pendiente' };

export type EnviarRecepcion = (comando: ComandoDeRecepcion) => Promise<ResultadoDeRecepcion>;

/**
 * El único punto por donde sale una recepción. La cola sin señal se monta
 * aquí: recibe el mismo comando y responde con el mismo tipo, sin tocar la
 * pantalla.
 */
export function useEnviarRecepcion(): EnviarRecepcion {
  const pedir = usePedir();
  return useCallback(
    async (comando) => {
      const recepcion = await pedir<RecepcionConfirmada>('/recepciones', {
        method: 'POST',
        body: JSON.stringify(comando),
      });
      return { estado: 'confirmada', recepcion };
    },
    [pedir],
  );
}
