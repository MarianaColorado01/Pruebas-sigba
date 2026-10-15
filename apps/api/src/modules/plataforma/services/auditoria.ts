import type { AccionDeAuditoria, RegistroDeAuditoria, TipoDeActor } from '@sigba/shared-types';

export interface FiltroDeAuditoria {
  /** UUID del usuario o etiqueta de la tarea del sistema. */
  actor?: string;
  tipoActor?: TipoDeActor;
  entidad?: string;
  accion?: AccionDeAuditoria;
  /** Incluido. */
  desde?: Date;
  /** Excluido. */
  hasta?: Date;
}

/** Último registro de la página anterior; la siguiente empieza justo antes. */
export interface PosicionEnAuditoria {
  ocurridoEn: string;
  id: string;
}

/** El periodo pedido tiene más registros de los que se exportan de una vez. */
export class ExportacionDemasiadoGrande extends Error {
  constructor(readonly maximo: number) {
    super(`El periodo tiene más de ${maximo} registros de auditoría.`);
  }
}

/**
 * Puerto de solo lectura sobre `core.auditoria` (SBA-51). El adaptador lee
 * con el banco del contexto de tenant y registra la lectura en la misma
 * transacción: consultar la auditoría también queda auditado.
 */
export abstract class AuditoriaRepositorio {
  /**
   * Hasta `limite` registros, del más reciente al más antiguo, anteriores a
   * `antesDe`. `hayMas` dice si quedan otros.
   */
  abstract listar(
    filtro: FiltroDeAuditoria,
    antesDe: PosicionEnAuditoria | undefined,
    limite: number,
  ): Promise<{ registros: RegistroDeAuditoria[]; hayMas: boolean }>;

  /**
   * Los registros de `[desde, hasta)` en orden cronológico. Lanza
   * `ExportacionDemasiadoGrande` si pasan de `maximo`, sin registrar lectura.
   */
  abstract exportar(desde: Date, hasta: Date, maximo: number): Promise<RegistroDeAuditoria[]>;
}
