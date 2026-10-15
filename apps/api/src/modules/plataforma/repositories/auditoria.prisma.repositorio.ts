import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RegistroDeAuditoria } from '@sigba/shared-types';
import { AuditService, executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import {
  AuditoriaRepositorio,
  ExportacionDemasiadoGrande,
  type FiltroDeAuditoria,
  type PosicionEnAuditoria,
} from '../services/auditoria.js';

/**
 * El instante sale como texto con microsegundos, que es lo que guarda
 * PostgreSQL y lo que el cursor necesita para no saltarse registros.
 *
 * `usuario` deja ver a quien tiene asignación en el banco del contexto
 * (SBA-61): de alguien que ya no la tiene queda el id sin nombre.
 */
const SELECCION = Prisma.sql`
  SELECT a.id::text AS id,
         to_char(a.ocurrido_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "ocurridoEn",
         a.actor_tipo AS "tipoActor",
         a.actor_id::text AS "actorId",
         u.nombre AS "actorNombre",
         a.actor_etiqueta AS "actorEtiqueta",
         a.accion,
         a.entidad,
         a.entidad_id AS "entidadId",
         a.resultado,
         a.finalidad,
         a.detalle
  FROM core.auditoria a
  LEFT JOIN plataforma.usuario u ON u.id = a.actor_id`;

function condiciones(filtro: FiltroDeAuditoria, antesDe?: PosicionEnAuditoria): Prisma.Sql {
  const partes: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filtro.actor) {
    partes.push(
      Prisma.sql`(a.actor_id::text = ${filtro.actor} OR a.actor_etiqueta = ${filtro.actor})`,
    );
  }
  if (filtro.tipoActor) partes.push(Prisma.sql`a.actor_tipo = ${filtro.tipoActor}`);
  if (filtro.entidad) partes.push(Prisma.sql`a.entidad = ${filtro.entidad}`);
  if (filtro.accion) partes.push(Prisma.sql`a.accion = ${filtro.accion}`);
  if (filtro.desde) partes.push(Prisma.sql`a.ocurrido_en >= ${filtro.desde}`);
  if (filtro.hasta) partes.push(Prisma.sql`a.ocurrido_en < ${filtro.hasta}`);
  if (antesDe) {
    partes.push(
      Prisma.sql`(a.ocurrido_en, a.id) < (${antesDe.ocurridoEn}::timestamptz, ${antesDe.id}::uuid)`,
    );
  }
  return Prisma.join(partes, ' AND ');
}

/**
 * Lectura de `core.auditoria` para plataforma. El banco no se filtra aquí:
 * lo pone RLS con el `app.banco_id` de la transacción. Cada consulta registra
 * su propia lectura en la misma transacción.
 */
@Injectable()
export class AuditoriaPrismaRepositorio extends AuditoriaRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async listar(
    filtro: FiltroDeAuditoria,
    antesDe: PosicionEnAuditoria | undefined,
    limite: number,
  ): Promise<{ registros: RegistroDeAuditoria[]; hayMas: boolean }> {
    return executeTransactionWithTenant<{ registros: RegistroDeAuditoria[]; hayMas: boolean }>(
      this.prisma,
      async (tx) => {
        const filas = await tx.$queryRaw<RegistroDeAuditoria[]>`
        ${SELECCION}
        WHERE ${condiciones(filtro, antesDe)}
        ORDER BY a.ocurrido_en DESC, a.id DESC
        LIMIT ${limite + 1}`;
        const registros = filas.slice(0, limite);

        await this.auditoria.registrarLectura(tx, {
          entidad: 'auditoria',
          conjunto: 'auditoria',
          cantidad: registros.length,
          finalidad: 'consulta_de_auditoria',
        });
        return { registros, hayMas: filas.length > limite };
      },
    );
  }

  async exportar(desde: Date, hasta: Date, maximo: number): Promise<RegistroDeAuditoria[]> {
    return executeTransactionWithTenant<RegistroDeAuditoria[]>(this.prisma, async (tx) => {
      const registros = await tx.$queryRaw<RegistroDeAuditoria[]>`
        ${SELECCION}
        WHERE ${condiciones({ desde, hasta })}
        ORDER BY a.ocurrido_en, a.id
        LIMIT ${maximo + 1}`;
      if (registros.length > maximo) throw new ExportacionDemasiadoGrande(maximo);

      await this.auditoria.registrarLectura(tx, {
        entidad: 'auditoria',
        conjunto: 'auditoria',
        cantidad: registros.length,
        finalidad: 'exportacion_de_auditoria',
      });
      return registros;
    });
  }
}
