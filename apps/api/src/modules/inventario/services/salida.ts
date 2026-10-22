import { ConflictException } from '@nestjs/common';

/**
 * Salida a institución y el puerto por el que se guarda (SBA-38, SBA-40).
 *
 * Cada detalle es un movimiento 'salida' del libro que resta del lote en la
 * bodega (ADR-08). La institución vive en beneficiarios, que la valida; aquí
 * solo se guarda su id (ADR-14).
 */

export const TIPOS_DE_DESPACHADOR = ['funcionario', 'voluntario'] as const;
export type TipoDeDespachador = (typeof TIPOS_DE_DESPACHADOR)[number];

/**
 * Lo que manda el cliente. `comandoId` y cada `movimientoId` los genera él
 * (UUIDv7), para que reenviar la salida no descuente dos veces.
 */
export interface RegistrarSalida {
  comandoId: string;
  institucionId: string;
  bodegaId: string;
  /** Quien entregó en bodega. Puede no tener usuario en SIGBA. */
  despachador: string;
  despachadorTipo: TipoDeDespachador;
  detalles: {
    movimientoId: string;
    referenciaId: string;
    loteId: string;
    /** Las unidades que salen, mayor que cero. El signo lo pone el servidor. */
    cantidad: string | number;
  }[];
}

/**
 * El comando validado, con la que se compara un reenvío. No lleva el nombre
 * del despachador: el hash de la carga no tiene llave y no admite datos
 * personales (Arquitectura 8.6).
 */
export interface CargaDeSalida {
  institucionId: string;
  bodegaId: string;
  despachadorTipo: TipoDeDespachador;
  detalles: { movimientoId: string; referenciaId: string; loteId: string; cantidad: string }[];
}

export interface DatosDeSalida {
  comandoId: string;
  carga: CargaDeSalida;
  despachador: string;
  /** Kilos de cada detalle, en el orden de la carga, sin signo. */
  kilos: string[];
  /** `aporte_solidario_pct` vigente hoy; nulo si el banco no lo tiene. */
  aportePct: string | null;
  /** AAAA-MM-DD en Colombia: el día cuyo precio aprobado vale. */
  hoy: string;
}

/** Sin precio aprobado vigente el detalle queda pendiente, nunca en cero (ADR-13). */
export type ValoracionDeSalida = 'pendiente' | 'con_precio';

export interface DetalleDeSalida {
  movimientoId: string;
  referenciaId: string;
  categoriaId: string;
  loteId: string;
  /** Lo que salió, en positivo. */
  cantidad: string;
  kilos: string;
  valoracion: ValoracionDeSalida;
  /** Del precio aprobado que respalda el valor; nulos si está pendiente. */
  valorUnitario: string | null;
  fuente: string | null;
  valorComercial: string | null;
  /** Valor comercial por el porcentaje de la salida; nulo si falta alguno. */
  aporte: string | null;
}

export interface Salida {
  id: string;
  institucionId: string;
  bodegaId: string;
  despachador: string;
  despachadorTipo: TipoDeDespachador;
  aportePct: string | null;
  registradaEn: Date;
  detalles: DetalleDeSalida[];
}

export interface SalidaRegistrada {
  salida: Salida;
  /** El comando ya estaba: el controlador responde 200 con lo mismo y no 201. */
  repetida: boolean;
}

/** Lo que la salida necesita saber de cada lote antes de escribir. */
export interface LoteParaSalida {
  loteId: string;
  referenciaId: string;
  equivalenciaKg: string;
  /** AAAA-MM-DD, o nulo si el producto no trae fecha. */
  vencimiento: string | null;
}

export interface Faltante {
  loteId: string;
  referenciaId: string;
  solicitado: string;
  disponible: string;
}

/**
 * La bodega no tiene lo que la salida pide (RF-M1-11). Responde 409 con
 * `codigo: 'sin_stock'` y los lotes que no alcanzaban al momento del rechazo,
 * para que la cola del celular
 * distinga este rechazo de un comando repetido con otra carga y lo conserve
 * para que la coordinación concilie la entrega física.
 */
export class SalidaSinStock extends ConflictException {
  constructor(readonly faltantes: Faltante[]) {
    super({
      statusCode: 409,
      error: 'Conflict',
      codigo: 'sin_stock',
      message: 'No hay stock suficiente en la bodega para esta salida.',
      faltantes,
    });
  }
}

/** Lo que quien despacha ve de una institución para elegir destinatario. */
export interface InstitucionParaSalida {
  id: string;
  nombre: string;
}

export abstract class SalidasRepositorio {
  /** Las instituciones activas del banco, por nombre (SBA-33). */
  abstract institucionesActivas(): Promise<InstitucionParaSalida[]>;

  /**
   * Los lotes del banco con esos ids. Uno de otro banco no aparece. Vale
   * aunque la referencia esté desactivada: lo que está en bodega se despacha.
   */
  abstract lotes(ids: string[]): Promise<LoteParaSalida[]>;

  /**
   * Reclama el comando y, si es nuevo, valida la institución y escribe
   * salida, movimientos, detalles, valoración, auditoría y el evento
   * `SalidaRegistrada` en una sola transacción. Misma carga: devuelve la
   * salida sin escribir ni validar; otra carga, 409. Institución inactiva o
   * de otro banco: 404. Sin stock en algún lote lanza `SalidaSinStock`. En
   * los dos rechazos no queda nada.
   */
  abstract registrar(datos: DatosDeSalida): Promise<SalidaRegistrada>;

  /** La salida que ya dejó este comando con esta carga, o nulo. Otra carga, 409. */
  abstract repetida(comandoId: string, carga: CargaDeSalida): Promise<SalidaRegistrada | null>;
}
