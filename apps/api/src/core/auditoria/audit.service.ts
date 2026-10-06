import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TenantContext } from '../database/tenant-context.js';
import { getTenantContext } from '../database/tenant-context.js';

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

interface ActorResuelto {
  actorTipo: 'usuario' | 'sistema';
  actorId: string | null;
  actorEtiqueta: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

export function resolverActor(contexto: TenantContext): ActorResuelto {
  const usuarioId = contexto.usuarioId;
  if (!usuarioId) throw new Error('Falta el actor en el contexto de tenant.');

  // TODO(SBA-8): formalizar el actor con quien mantiene el tenant
  if (UUID.test(usuarioId)) {
    return { actorTipo: 'usuario', actorId: usuarioId, actorEtiqueta: null };
  }
  return { actorTipo: 'sistema', actorId: null, actorEtiqueta: usuarioId };
}

@Injectable()
export class AuditService {
  async registrar(tx: Prisma.TransactionClient, entrada: EntradaDeAuditoria): Promise<void> {
    if (entrada.detalle !== undefined) validarDetalle(entrada.detalle);

    const contexto = getTenantContext();
    if (!contexto?.bancoId) throw new Error('Falta el banco en el contexto de tenant.');
    resolverActor(contexto);

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
