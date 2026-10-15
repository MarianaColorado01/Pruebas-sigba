/**
 * Bajas y ajustes de inventario y el puerto por el que se guardan (SBA-42).
 *
 * Los dos son un movimiento del libro con su motivo: la baja resta lo que se
 * venció, se rompió o se perdió; el ajuste corrige una diferencia de conteo en
 * cualquier sentido. Nadie edita un saldo: lo mueve el libro (ADR-08).
 */

export const MOTIVOS_DE_BAJA = ['vencido', 'no_apto', 'roto', 'perdida'] as const;
export type MotivoDeBaja = (typeof MOTIVOS_DE_BAJA)[number];

export type TipoDeMovimientoManual = 'baja' | 'ajuste';

/**
 * Lo que manda el cliente. `comandoId` y `movimientoId` los genera él
 * (UUIDv7), para que reenviar el comando no mueva el lote dos veces.
 */
interface ComandoSobreUnLote {
  comandoId: string;
  movimientoId: string;
  bodegaId: string;
  referenciaId: string;
  loteId: string;
}

export interface RegistrarBaja extends ComandoSobreUnLote {
  /** Las unidades que salen, mayor que cero. El signo lo pone el servidor. */
  cantidad: string | number;
  motivo: MotivoDeBaja;
}

export interface RegistrarAjuste extends ComandoSobreUnLote {
  /** Con signo: positiva si el conteo encontró de más, negativa si de menos. */
  cantidad: string | number;
  motivo: string;
}

/**
 * El comando validado y limpio, sin los kilos que calcula el servidor. Es la
 * carga con que se compara un reenvío. `cantidad` ya lleva el signo con que
 * entra al libro.
 */
export interface CargaDeMovimientoManual {
  movimientoId: string;
  bodegaId: string;
  referenciaId: string;
  loteId: string;
  cantidad: string;
  motivo: string;
}

export interface DatosDeMovimientoManual {
  tipo: TipoDeMovimientoManual;
  comandoId: string;
  carga: CargaDeMovimientoManual;
  /** Con el mismo signo que la cantidad. */
  kilos: string;
}

export interface MovimientoManual {
  movimientoId: string;
  tipo: TipoDeMovimientoManual;
  bodegaId: string;
  referenciaId: string;
  loteId: string;
  cantidad: string;
  kilos: string;
  motivo: string;
  registradoEn: Date;
}

export interface MovimientoManualRegistrado {
  movimiento: MovimientoManual;
  /** El comando ya estaba: el controlador responde 200 con lo mismo y no 201. */
  repetida: boolean;
}

export abstract class BajasYAjustesRepositorio {
  /**
   * La equivalencia en kilos congelada en el lote al recibirlo (SBA-35), o
   * nulo si el banco no tiene ese lote o el lote es de otra referencia. Vale
   * aunque la referencia esté desactivada: lo que ya está en bodega se puede
   * dar de baja.
   */
  abstract equivalenciaDelLote(loteId: string, referenciaId: string): Promise<string | null>;

  /**
   * Reclama el comando y, si es nuevo, escribe el movimiento, su motivo y la
   * auditoría en una sola transacción. Si el banco ya procesó el comando con
   * la misma carga, devuelve ese movimiento sin escribir; con otra carga, 409.
   * Un movimiento que deja el lote en negativo es 409 y no deja nada, y un
   * ajuste positivo de un lote que nunca estuvo en esa bodega también: un
   * ajuste corrige un conteo, no crea existencias.
   */
  abstract registrar(datos: DatosDeMovimientoManual): Promise<MovimientoManualRegistrado>;

  /**
   * El movimiento que el banco ya registró con este comando y esta carga, sin
   * reservar nada; `null` si el comando no está. Con otra carga, 409.
   */
  abstract repetido(
    tipo: TipoDeMovimientoManual,
    comandoId: string,
    carga: CargaDeMovimientoManual,
  ): Promise<MovimientoManualRegistrado | null>;
}
