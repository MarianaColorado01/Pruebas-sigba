/**
 * Maestro de precios y el puerto por el que se guarda (SBA-39, ADR-13).
 *
 * Un precio vale para una referencia genérica (producto y presentación, sin
 * marca), en pesos por unidad de la presentación. Nace propuesto; solo la
 * coordinación lo aprueba, y sin aprobación no se usa para valorar. Aprobar uno
 * nuevo cierra la vigencia del anterior sin borrarlo.
 *
 * El banco y el actor no viajan por aquí; los pone el adaptador desde el
 * contexto de tenant, igual que RLS.
 */

export const FUENTES = ['remision', 'sipsa', 'catalogo', 'manual'] as const;
export type Fuente = (typeof FUENTES)[number];

/** Lo que guarda la base. «Vencido» no se guarda: se deriva de la fecha. */
export type EstadoGuardado = 'propuesto' | 'aprobado';

/** Vencido es un aprobado cuya vigencia terminó antes de la fecha consultada. */
export type EstadoDePrecio = EstadoGuardado | 'vencido';

/**
 * Lo que manda la coordinación al proponer. Los valores van en pesos con punto
 * decimal; las fechas, AAAA-MM-DD. Sin `vigenteHasta` la vigencia dura lo que
 * fija el servicio.
 */
export interface ProponerPrecio {
  comandoId: string;
  referenciaId: string;
  valor: string | number;
  piso: string | number;
  techo: string | number;
  fuente: Fuente;
  evidencia: string;
  vigenteDesde: string;
  vigenteHasta?: string | null;
}

export interface AprobarPrecio {
  comandoId: string;
  precioId: string;
  /** Obligatorio si el valor queda fuera de la banda de piso y techo. */
  motivoFueraDeBanda?: string | null;
}

/**
 * La propuesta validada y limpia, tal como llegó. Es la carga con que se
 * compara un reenvío: el fin de vigencia por defecto no entra, para que
 * cambiar esa duración no convierta un reenvío en 409.
 */
export interface CargaDePrecio {
  referenciaId: string;
  valor: string;
  piso: string;
  techo: string;
  fuente: Fuente;
  evidencia: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

export interface DatosDePrecio {
  comandoId: string;
  carga: CargaDePrecio;
  /** El fin de vigencia que se guarda: el enviado o el calculado. */
  vigenteHasta: string;
}

export interface CargaDeAprobacion {
  precioId: string;
  motivoFueraDeBanda: string | null;
}

export interface DatosDeAprobacion {
  comandoId: string;
  carga: CargaDeAprobacion;
}

export interface PrecioGuardado {
  id: string;
  referenciaId: string;
  /** Decimales como texto, para no perder precisión en el camino. */
  valor: string;
  piso: string;
  techo: string;
  fuente: Fuente;
  evidencia: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
  estado: EstadoGuardado;
  motivoFueraDeBanda: string | null;
  aprobadoPor: string | null;
  aprobadoEn: Date | null;
  creadoPor: string;
  creadoEn: Date;
}

export interface Precio extends Omit<PrecioGuardado, 'estado'> {
  estado: EstadoDePrecio;
}

export interface PrecioRegistrado {
  precio: PrecioGuardado;
  /** El comando ya estaba: el controlador responde 200 con lo mismo y no 201. */
  repetida: boolean;
}

export abstract class PreciosRepositorio {
  /**
   * Reclama el comando y, si es nuevo, guarda el precio propuesto y su
   * auditoría en una transacción. Misma carga: devuelve el precio guardado;
   * otra carga, 409. Una referencia que el banco no tiene, 404.
   */
  abstract proponer(datos: DatosDePrecio): Promise<PrecioRegistrado>;

  /** El precio del banco con ese id, o `null`. */
  abstract obtener(id: string): Promise<PrecioGuardado | null>;

  /**
   * Reclama el comando y, si es nuevo, aprueba el precio propuesto, cierra el
   * aprobado anterior de la misma referencia que se cruce con su vigencia y
   * audita ambos cambios, en una transacción. Un precio ya aprobado, o una
   * vigencia que choca con un aprobado que no se puede cerrar, es 409.
   */
  abstract aprobar(datos: DatosDeAprobacion): Promise<PrecioRegistrado>;

  /** Todos los precios de la referencia, propuestos y aprobados, del más reciente al más antiguo. */
  abstract historial(referenciaId: string): Promise<PrecioGuardado[]>;

  /** El aprobado cuya vigencia cubre la fecha, o `null`. Nunca un propuesto. */
  abstract aprobadoEn(referenciaId: string, fecha: string): Promise<PrecioGuardado | null>;
}
