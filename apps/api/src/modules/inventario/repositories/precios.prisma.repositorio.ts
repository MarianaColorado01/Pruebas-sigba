import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  PrismaService,
} from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import {
  type DatosDeAprobacion,
  type DatosDePrecio,
  type PrecioGuardado,
  type PrecioRegistrado,
  PreciosRepositorio,
} from '../services/precio.js';
import { bloquearReferencias, valorarPendientes } from './valoracion.js';

const COLUMNAS = {
  id: true,
  referenciaId: true,
  valor: true,
  piso: true,
  techo: true,
  fuente: true,
  evidencia: true,
  vigenteDesde: true,
  vigenteHasta: true,
  estado: true,
  motivoFueraDeBanda: true,
  aprobadoPor: true,
  aprobadoEn: true,
  creadoPor: true,
  creadoEn: true,
} satisfies Prisma.PrecioSelect;

type FilaDePrecio = Prisma.PrecioGetPayload<{ select: typeof COLUMNAS }>;

/**
 * Adaptador de Prisma para el maestro de precios. Cada escritura reclama el
 * comando, escribe y audita en una sola `executeTransactionWithTenant`, con
 * el mismo `tx` (ADR-08, Arquitectura 6.1). Las consultas filtran además por
 * `banco_id`, porque en local `DATABASE_URL` suele ser superusuario y se salta
 * RLS.
 */
@Injectable()
export class PreciosPrismaRepositorio extends PreciosRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async proponer({ comandoId, carga, vigenteHasta }: DatosDePrecio): Promise<PrecioRegistrado> {
    const { bancoId, actor } = conActor();
    // El id se genera antes: la reserva del comando guarda el del precio.
    const id = randomUUID();

    try {
      return await executeTransactionWithTenant<PrecioRegistrado>(this.prisma, async (tx) => {
        const previo = await this.idempotencia.reclamar(tx, {
          comandoId,
          carga,
          resultado: { entidad: 'precio', entidadId: id },
        });
        if (previo) return { precio: await leer(tx, previo.entidadId), repetida: true };

        const fila = await tx.precio.create({
          data: {
            ...carga,
            id,
            bancoId,
            vigenteDesde: dia(carga.vigenteDesde),
            vigenteHasta: dia(vigenteHasta),
            creadoPor: actor,
            actualizadoPor: actor,
          },
          select: COLUMNAS,
        });
        await this.auditoria.registrar(tx, { accion: 'crear', entidad: 'precio', entidadId: id });
        return { precio: aPrecio(fila), repetida: false };
      });
    } catch (error) {
      // La FK es compuesta con banco_id: una referencia de otro banco sale
      // igual que una que no existe.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new NotFoundException('No existe esa referencia.');
      }
      throw error;
    }
  }

  async obtener(id: string): Promise<PrecioGuardado | null> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<PrecioGuardado | null>(this.prisma, async (tx) => {
      const fila = await tx.precio.findFirst({ where: { id, bancoId }, select: COLUMNAS });
      return fila && aPrecio(fila);
    });
  }

  async aprobar({ comandoId, carga }: DatosDeAprobacion): Promise<PrecioRegistrado> {
    const { bancoId, actor } = conActor();
    const { precioId, motivoFueraDeBanda } = carga;

    try {
      return await executeTransactionWithTenant<PrecioRegistrado>(this.prisma, async (tx) => {
        const previo = await this.idempotencia.reclamar(tx, {
          comandoId,
          carga,
          resultado: { entidad: 'precio', entidadId: precioId },
        });
        if (previo) return { precio: await leer(tx, previo.entidadId), repetida: true };

        // FOR UPDATE: dos aprobaciones del mismo precio con comandos distintos
        // se ponen en fila, y la segunda ve que ya está aprobado.
        const [actual] = await tx.$queryRaw<{ estado: string; referenciaId: string }[]>`
          SELECT estado::text, referencia_id::text AS "referenciaId" FROM inventario.precio
          WHERE id = ${precioId}::uuid AND banco_id = ${bancoId}::uuid
          FOR UPDATE`;
        if (!actual) throw new NotFoundException('No existe ese precio.');
        if (actual.estado !== 'propuesto') {
          throw new ConflictException('Ese precio ya está aprobado.');
        }
        // Espera a las recepciones de la referencia que estén en curso, para
        // valorarlas también (ver bloquearReferencias).
        await bloquearReferencias(tx, bancoId, [actual.referenciaId], 'aprobacion');

        // El aprobado anterior que se cruce termina el día antes de que empiece
        // este, y queda en el historial.
        const cerrados = await tx.$queryRaw<{ id: string }[]>`
          UPDATE inventario.precio AS anterior
          SET vigente_hasta = nuevo.vigente_desde - 1,
              actualizado_por = ${actor},
              actualizado_en = now()
          FROM inventario.precio AS nuevo
          WHERE nuevo.id = ${precioId}::uuid
            AND anterior.banco_id = ${bancoId}::uuid
            AND anterior.referencia_id = nuevo.referencia_id
            AND anterior.estado = 'aprobado'
            AND anterior.vigente_desde < nuevo.vigente_desde
            AND (anterior.vigente_hasta IS NULL OR anterior.vigente_hasta >= nuevo.vigente_desde)
          RETURNING anterior.id::text`;
        await tx.$executeRaw`
          UPDATE inventario.precio
          SET estado = 'aprobado',
              motivo_fuera_de_banda = ${motivoFueraDeBanda},
              aprobado_por = ${actor},
              aprobado_en = now(),
              actualizado_por = ${actor},
              actualizado_en = now()
          WHERE id = ${precioId}::uuid AND banco_id = ${bancoId}::uuid`;

        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'precio',
          entidadId: precioId,
          detalle: {
            camposModificados: ['estado', 'motivo_fuera_de_banda', 'aprobado_por', 'aprobado_en'],
          },
        });
        for (const { id } of cerrados) {
          await this.auditoria.registrar(tx, {
            accion: 'actualizar',
            entidad: 'precio',
            entidadId: id,
            detalle: { camposModificados: ['vigente_hasta'] },
          });
        }

        // Valoración tardía (SBA-43): las entradas pendientes de la referencia
        // recibidas dentro de la vigencia quedan valoradas con este precio. Va
        // después de aprobar, con la vigencia ya definitiva.
        await valorarPendientes(tx, this.auditoria, { bancoId, actor }, { precioId });

        // PrecioActualizado va aquí, con este mismo `tx`, cuando exista el
        // outbox (SBA-30). Lleva lo que el reporte de ingresos de M3 necesita
        // de la valoración tardía; esa carga la acuerdan los capitanes de los
        // equipos 2 y 3 antes de escribir el consumidor.

        return { precio: await leer(tx, precioId), repetida: false };
      });
    } catch (error) {
      // La exclusión precio_aprobados_sin_cruce: hay un aprobado que empieza
      // el mismo día o después, y cerrarlo lo dejaría terminando antes de
      // empezar. También atrapa dos aprobaciones simultáneas que se cruzan.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2010' &&
        error.meta?.['code'] === '23P01'
      ) {
        throw new ConflictException(
          'La vigencia se cruza con otro precio aprobado de la referencia que empieza el mismo día o después.',
        );
      }
      throw error;
    }
  }

  async historial(referenciaId: string): Promise<PrecioGuardado[]> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<PrecioGuardado[]>(this.prisma, async (tx) =>
      (
        await tx.precio.findMany({
          where: { bancoId, referenciaId },
          orderBy: [{ vigenteDesde: 'desc' }, { creadoEn: 'desc' }],
          select: COLUMNAS,
        })
      ).map(aPrecio),
    );
  }

  async aprobadoEn(referenciaId: string, fecha: string): Promise<PrecioGuardado | null> {
    const { bancoId } = contexto();
    return executeTransactionWithTenant<PrecioGuardado | null>(this.prisma, async (tx) => {
      // La exclusión garantiza que a lo sumo uno cubre la fecha.
      const fila = await tx.precio.findFirst({
        where: {
          bancoId,
          referenciaId,
          estado: 'aprobado',
          vigenteDesde: { lte: dia(fecha) },
          OR: [{ vigenteHasta: null }, { vigenteHasta: { gte: dia(fecha) } }],
        },
        select: COLUMNAS,
      });
      return fila && aPrecio(fila);
    });
  }
}

function conActor(): { bancoId: string; actor: string } {
  const { bancoId, actor } = contexto();
  if (!actor) throw new Error('Precio sin actor en el contexto de tenant.');
  return { bancoId, actor };
}

async function leer(tx: Prisma.TransactionClient, id: string): Promise<PrecioGuardado> {
  return aPrecio(await tx.precio.findUniqueOrThrow({ where: { id }, select: COLUMNAS }));
}

/** Las columnas DATE llegan como medianoche UTC. */
function dia(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

function aFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function aPrecio({ valor, piso, techo, vigenteDesde, vigenteHasta, ...resto }: FilaDePrecio) {
  return {
    ...resto,
    valor: valor.toString(),
    piso: piso.toString(),
    techo: techo.toString(),
    vigenteDesde: aFecha(vigenteDesde),
    vigenteHasta: vigenteHasta && aFecha(vigenteHasta),
  };
}
