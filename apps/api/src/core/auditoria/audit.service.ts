import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AccionDeAuditoria } from '@sigba/shared-types';

export type { AccionDeAuditoria };

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

/**
 * Lectura de un conjunto de datos personales. Guarda qué se leyó y cuántas
 * filas, nunca lo leído (Arquitectura 8.6).
 */
export interface LecturaDeAuditoria {
  /** Lo que se leyó, en singular: `beneficiario`. */
  entidad: string;
  /**
   * Nombre del conjunto, opcionalmente seguido de los UUID que lo acotan:
   * `beneficiarios_de_institucion:<institucionId>`. Nada de texto de búsqueda.
   */
  conjunto: string;
  cantidad: number;
  /** Código de la finalidad operativa: `entrega_de_mercado`. */
  finalidad: string;
}

const COLUMNA = /^[a-z_][a-z0-9_]*$/;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Solo un código y UUID: un nombre, un documento o un texto de búsqueda no
// caben, así que tampoco llegan a la auditoría.
const CONJUNTO = new RegExp(`^[a-z_][a-z0-9_]*(:${UUID})*$`);

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

  /**
   * Registra la consulta de un conjunto de datos personales, en la misma
   * transacción que la lee. Se llama después de leer, con las filas que
   * salen hacia quien consultó.
   */
  async registrarLectura(
    tx: Prisma.TransactionClient,
    { entidad, conjunto, cantidad, finalidad }: LecturaDeAuditoria,
  ): Promise<void> {
    if (!COLUMNA.test(entidad)) throw new Error('La entidad leída debe ser un código.');
    if (!CONJUNTO.test(conjunto)) {
      throw new Error('El conjunto leído solo admite un código y UUID, sin datos personales.');
    }
    if (!COLUMNA.test(finalidad)) throw new Error('La finalidad de la lectura debe ser un código.');
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      throw new Error('La cantidad leída debe ser un entero no negativo.');
    }

    await this.registrar(tx, {
      accion: 'leer',
      entidad,
      entidadId: conjunto,
      finalidad,
      detalle: { cantidad },
    });
  }
}
