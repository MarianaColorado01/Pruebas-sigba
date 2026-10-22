import { useCallback } from 'react';
import { usePedir } from '@/shared/sesion.ts';

export const MOTIVOS_DE_BAJA = ['vencido', 'no_apto', 'roto', 'perdida'] as const;
export type MotivoDeBaja = (typeof MOTIVOS_DE_BAJA)[number];

export type TipoDeMovimiento = 'baja' | 'ajuste';

/**
 * Lo que va a `POST /bajas` o `POST /ajustes` (SBA-42). En la baja,
 * `cantidad` es lo que sale, mayor que cero, y `motivo` uno de la lista; en el
 * ajuste, `cantidad` lleva signo y `motivo` es texto libre.
 */
export interface ComandoSobreUnLote {
  comandoId: string;
  movimientoId: string;
  bodegaId: string;
  referenciaId: string;
  loteId: string;
  /** Con punto decimal. */
  cantidad: string;
  motivo: string;
}

/** Lo que responde la API. `cantidad` y `kilos` llevan el signo con que entraron al libro. */
export interface MovimientoRegistrado {
  movimientoId: string;
  tipo: TipoDeMovimiento;
  bodegaId: string;
  referenciaId: string;
  loteId: string;
  cantidad: string;
  kilos: string;
  motivo: string;
  registradoEn: string;
}

/** El único punto por donde sale una baja o un ajuste. */
export function useRegistrarMovimiento() {
  const pedir = usePedir();
  return useCallback(
    (tipo: TipoDeMovimiento, comando: ComandoSobreUnLote) =>
      pedir<MovimientoRegistrado>(tipo === 'baja' ? '/bajas' : '/ajustes', {
        method: 'POST',
        body: JSON.stringify(comando),
      }),
    [pedir],
  );
}
