/**
 * Recepción de una donación y el puerto por el que se guarda (SBA-24).
 *
 * El puerto vive aquí y el adaptador de Prisma en `repositories/`: `services/`
 * no importa el SDK (RNF-03). El banco y el actor no viajan por aquí; los pone
 * el adaptador desde el contexto de tenant, igual que RLS.
 */

export const ORIGENES = ['propia', 'abaco', 'plataforma'] as const;
export type Origen = (typeof ORIGENES)[number];

export const NOVEDADES = ['roto', 'reempacado', 'no_apto'] as const;
export type Novedad = (typeof NOVEDADES)[number];

/**
 * Sin precio vigente aprobado, la fila queda pendiente: nunca en cero (ADR-13).
 * Hasta el maestro de precios (SBA-39) es el único estado.
 */
export type Valoracion = 'pendiente';

/**
 * Lo que manda el celular. `comandoId` y cada `movimientoId` los genera el
 * cliente (UUIDv7), para que reenviar el comando no duplique inventario.
 */
export interface RegistrarRecepcion {
  comandoId: string;
  donanteId: string;
  origen: Origen;
  bodegaId: string;
  detalles: FilaDeRecepcion[];
}

export interface FilaDeRecepcion {
  movimientoId: string;
  referenciaId: string;
  /** Unidades de la presentación, con punto decimal. La coma la convierte la PWA. */
  cantidad: string | number;
  /** El lote impreso en el empaque, si lo trae. */
  lote?: string | null;
  /** AAAA-MM-DD, o nulo si el producto no trae fecha (aseo, no alimentos). */
  vencimiento?: string | null;
  novedad?: Novedad | null;
}

/**
 * El comando validado y limpio, sin lo que calcula el servidor. Es la carga
 * con que se compara un reenvío: si entraran kilos o valoración, un cambio de
 * equivalencia entre dos envíos convertiría el reenvío en un 409.
 */
export interface CargaDeRecepcion {
  donanteId: string;
  origen: Origen;
  bodegaId: string;
  detalles: {
    movimientoId: string;
    referenciaId: string;
    /** Decimal como texto, para no perder precisión en el camino. */
    cantidad: string;
    lote: string | null;
    vencimiento: string | null;
    novedad: Novedad | null;
  }[];
}

export interface DetalleDeRecepcion {
  movimientoId: string;
  referenciaId: string;
  loteId: string;
  cantidad: string;
  kilos: string;
  lote: string | null;
  vencimiento: string | null;
  novedad: Novedad | null;
  valoracion: Valoracion;
}

export interface Recepcion {
  id: string;
  donanteId: string;
  origen: Origen;
  bodegaId: string;
  registradaEn: Date;
  /** En el orden en que llegaron las filas. */
  detalles: DetalleDeRecepcion[];
}

/** Lo que el adaptador recibe: la carga y los kilos de cada fila, en su orden. */
export interface DatosDeRecepcion {
  comandoId: string;
  carga: CargaDeRecepcion;
  kilos: string[];
}

export interface RecepcionRegistrada {
  recepcion: Recepcion;
  /** El comando ya estaba: el controlador responde 200 con lo mismo y no 201. */
  repetida: boolean;
}

export abstract class RecepcionesRepositorio {
  /**
   * Reclama el comando y, si es nuevo, escribe recepción, lotes, detalles, un
   * movimiento de entrada por fila y la auditoría en una sola transacción: o
   * queda todo o no queda nada. Si el banco ya procesó el comando con la misma
   * carga, devuelve esa recepción sin escribir; con otra carga, 409. Un
   * `movimientoId` que el banco ya tiene en el libro también es 409.
   */
  abstract registrar(datos: DatosDeRecepcion): Promise<RecepcionRegistrada>;

  /**
   * La recepción que el banco ya registró con este comando y esta carga, sin
   * reservar nada; `null` si el comando no está. Con otra carga, 409.
   */
  abstract repetida(
    comandoId: string,
    carga: CargaDeRecepcion,
  ): Promise<RecepcionRegistrada | null>;
}
