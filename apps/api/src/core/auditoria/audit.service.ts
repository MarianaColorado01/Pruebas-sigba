import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type AccionDeAuditoria = 'crear' | 'actualizar' | 'eliminar' | 'leer';

export interface EntradaDeAuditoria {
  accion: AccionDeAuditoria;
  entidad: string;
  entidadId: string;
  finalidad?: string;
  detalle?: DetalleAuditoria;
}

export interface DetalleAuditoria {
  camposModificados?: string[];
  version?: number;
  cantidad?: number;
}

const COLUMNA = /^[a-z_][a-z0-9_]*$/;

function validarDetalle(detalle: DetalleAuditoria): void {
  if (
    typeof detalle !== 'object' ||
    detalle === null ||
    Array.isArray(detalle) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(detalle))
  ) {
    throw new Error('El detalle de auditoría debe ser un objeto de metadatos.');
  }

  for (const clave of Reflect.ownKeys(detalle)) {
    if (typeof clave !== 'string') {
      throw new Error('Clave desconocida en el detalle de auditoría.');
    }
    const valor = Reflect.get(detalle, clave);
    if (clave === 'camposModificados') {
      if (
        !Array.isArray(valor) ||
        !valor.every((campo) => typeof campo === 'string' && COLUMNA.test(campo))
      ) {
        throw new Error('camposModificados debe contener nombres de columna válidos.');
      }
    } else if (clave === 'version' || clave === 'cantidad') {
      if (typeof valor !== 'number' || !Number.isInteger(valor)) {
        throw new Error(`${clave} debe ser un entero.`);
      }
    } else {
      throw new Error(`Clave desconocida en el detalle de auditoría: ${clave}.`);
    }
  }
}

/**
 * Registra en `core.auditoria` dentro de la transacción del llamador.
 *
 * Banco y actor no se pasan: `core.registrar_auditoria` los lee del
 * `set_config` que fijó `executeTransactionWithTenant`, y falla si faltan.
 */
@Injectable()
export class AuditService {
  async registrar(tx: Prisma.TransactionClient, entrada: EntradaDeAuditoria): Promise<void> {
    if (entrada.detalle !== undefined) validarDetalle(entrada.detalle);

    await tx.$queryRaw`
      SELECT core.registrar_auditoria(
        ${entrada.accion}::text,
        ${entrada.entidad}::text,
        ${entrada.entidadId}::text,
        ${entrada.finalidad ?? null}::text,
        ${entrada.detalle === undefined ? null : JSON.stringify(entrada.detalle)}::jsonb
      )
    `;
  }
}
