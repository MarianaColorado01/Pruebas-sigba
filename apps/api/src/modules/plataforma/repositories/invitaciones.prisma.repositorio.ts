import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  executeTransactionWithTenant,
  getTenantContext,
  type IdentidadDeAutenticacion,
  PrismaService,
} from '../../../core/index.js';
import {
  BancoInexistente,
  type CambioDeInvitacion,
  type FilaDeInvitacion,
  type InvitacionCreada,
  InvitacionesRepositorio,
  type NuevaInvitacion,
  PendienteConOtrosDatos,
  type ResultadoDeAceptacion,
} from '../services/invitacion.js';

const LLAVE_FORANEA_VIOLADA = 'P2003';
const UNICA_VIOLADA = 'P2002';

/** La pendiente que ganó la carrera por un correo. */
interface PendienteExistente {
  id: string;
  rol: string;
  institucionId: string | null;
  venceEn: Date;
  bancoNombre: string;
}

/** Quién escribe. Toda escritura de negocio registra su actor (RNF-04). */
function actor(): string {
  const usuarioId = getTenantContext()?.usuarioId;
  if (!usuarioId)
    throw new Error('Escritura en invitaciones sin usuario en el contexto de tenant.');
  return usuarioId;
}

/**
 * Adaptador de Prisma para invitaciones. Todo pasa por
 * `executeTransactionWithTenant` y la política por banco de
 * `plataforma.invitacion`. La auditoría no lleva correo ni token (D16).
 */
@Injectable()
export class InvitacionesPrismaRepositorio extends InvitacionesRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  /**
   * `super_admin` no tiene banco en el contexto: la transacción fija el de la
   * invitación (D7). Para los demás es el mismo; el servicio ya lo comprobó.
   *
   * El índice único parcial `invitacion_pendiente_por_correo_key` decide quién
   * gana si dos peticiones invitan al mismo correo a la vez; la que pierde
   * revierte su transacción, auditoría incluida, y lee la ganadora.
   */
  async crear({ rol, ...invitacion }: NuevaInvitacion): Promise<InvitacionCreada> {
    const creadoPorId = actor();
    const contexto = { ...getTenantContext(), bancoId: invitacion.bancoId };
    try {
      return await executeTransactionWithTenant<InvitacionCreada>(
        this.prisma,
        async (tx) => {
          const { id: rolId } = await tx.rol.findUniqueOrThrow({
            where: { codigo: rol },
            select: { id: true },
          });
          const { id, venceEn, banco } = await tx.invitacion.create({
            data: { ...invitacion, rolId, creadoPorId },
            select: { id: true, venceEn: true, banco: { select: { nombre: true } } },
          });
          await this.auditoria.registrar(tx, {
            accion: 'crear',
            entidad: 'invitacion',
            entidadId: id,
          });
          return { id, bancoNombre: banco.nombre, venceEn, yaExistia: false };
        },
        contexto,
      );
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
      if (error.code === LLAVE_FORANEA_VIOLADA) throw new BancoInexistente();
      if (error.code !== UNICA_VIOLADA) throw error;

      const existente = await this.pendienteDe(invitacion, contexto);
      if (!existente) throw error;
      if (existente.rol !== rol || existente.institucionId !== invitacion.institucionId) {
        throw new PendienteConOtrosDatos();
      }
      return {
        id: existente.id,
        bancoNombre: existente.bancoNombre,
        venceEn: existente.venceEn,
        yaExistia: true,
      };
    }
  }

  private pendienteDe(
    { bancoId, email }: Pick<NuevaInvitacion, 'bancoId' | 'email'>,
    contexto: NonNullable<ReturnType<typeof getTenantContext>>,
  ) {
    return executeTransactionWithTenant<PendienteExistente | null>(
      this.prisma,
      async (tx) => {
        const fila = await tx.invitacion.findFirst({
          where: { bancoId, email, aceptadaEn: null, revocadaEn: null },
          select: {
            id: true,
            institucionId: true,
            venceEn: true,
            rol: { select: { codigo: true } },
            banco: { select: { nombre: true } },
          },
        });
        return fila
          ? {
              id: fila.id,
              rol: fila.rol.codigo,
              institucionId: fila.institucionId,
              venceEn: fila.venceEn,
              bancoNombre: fila.banco.nombre,
            }
          : null;
      },
      contexto,
    );
  }

  async listar(): Promise<FilaDeInvitacion[]> {
    return executeTransactionWithTenant<FilaDeInvitacion[]>(this.prisma, async (tx) => {
      const filas = await tx.invitacion.findMany({
        where: { revocadaEn: null },
        orderBy: { creadoEn: 'desc' },
        select: {
          id: true,
          email: true,
          nombre: true,
          venceEn: true,
          creadoEn: true,
          aceptadaEn: true,
          rol: { select: { codigo: true } },
          aceptadaPor: { select: { nombre: true } },
        },
      });
      return filas.map(({ rol, aceptadaPor, ...fila }) => ({
        ...fila,
        rol: rol.codigo,
        aceptadaPorNombre: aceptadaPor?.nombre ?? null,
      }));
    });
  }

  renovarToken(id: string, tokenHash: string, venceEn: Date): Promise<CambioDeInvitacion> {
    return this.cambiarPendiente(id, { tokenHash, venceEn }, ['token_hash', 'vence_en']);
  }

  revocar(id: string): Promise<CambioDeInvitacion> {
    return this.cambiarPendiente(id, { revocadaEn: new Date() }, ['revocada_en']);
  }

  /**
   * Sin contexto de banco: la función lo fija cuando encuentra la invitación.
   * Ella crea el usuario, la asignación y la auditoría en una transacción.
   */
  async aceptar(
    tokenHash: string,
    { emisor, auth0Sub, email }: IdentidadDeAutenticacion,
  ): Promise<ResultadoDeAceptacion> {
    const [fila] = await this.prisma.$queryRaw<
      { resultado: string; bancoId: string | null; rol: string | null }[]
    >`
      SELECT resultado, banco_id::text AS "bancoId", rol
      FROM plataforma.aceptar_invitacion(${tokenHash}, ${emisor}, ${auth0Sub}, ${email ?? null})
    `;
    if (!fila) throw new Error('plataforma.aceptar_invitacion no devolvió resultado.');
    if (fila.resultado === 'aceptada') {
      return { resultado: 'aceptada', bancoId: fila.bancoId!, rol: fila.rol! };
    }
    return { resultado: fila.resultado as Exclude<ResultadoDeAceptacion['resultado'], 'aceptada'> };
  }

  /**
   * Solo cambia una pendiente. updateMany y no update: con RLS, una invitación
   * de otro banco no es un error sino cero filas, y no se distingue de una que
   * no existe.
   */
  private cambiarPendiente(
    id: string,
    cambios: Prisma.InvitacionUncheckedUpdateManyInput,
    camposModificados: string[],
  ): Promise<CambioDeInvitacion> {
    return executeTransactionWithTenant<CambioDeInvitacion>(this.prisma, async (tx) => {
      const { count } = await tx.invitacion.updateMany({
        where: { id, aceptadaEn: null, revocadaEn: null },
        data: cambios,
      });
      if (count === 0) {
        const existe = await tx.invitacion.count({ where: { id } });
        return existe ? 'cerrada' : 'no_existe';
      }
      await this.auditoria.registrar(tx, {
        accion: 'actualizar',
        entidad: 'invitacion',
        entidadId: id,
        detalle: { camposModificados },
      });
      const { email, nombre, banco } = await tx.invitacion.findUniqueOrThrow({
        where: { id },
        select: { email: true, nombre: true, banco: { select: { nombre: true } } },
      });
      return { email, nombre, bancoNombre: banco.nombre };
    });
  }
}
