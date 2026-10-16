import { Injectable } from '@nestjs/common';
import {
  AuditService,
  executeTransactionWithTenant,
  getTenantContext,
  PrismaService,
  type IdentidadDeAutenticacion,
} from '../../../core/index.js';
import {
  type FilaDeAsignacion,
  type FilaDeUsuarioDelBanco,
  UsuariosRepositorio,
} from '../services/usuario.js';

/** El banco de la petición. Sin banco no hay a quién listar ni desactivar. */
function bancoDelContexto(): string {
  const bancoId = getTenantContext()?.bancoId;
  if (!bancoId) throw new Error('Operación de usuarios sin banco en el contexto de tenant.');
  return bancoId;
}

/**
 * Adaptador de Prisma para usuarios y sus asignaciones.
 *
 * La búsqueda por identidad corre antes de que exista contexto de tenant, y
 * sin contexto la política de `usuario` no deja ver ninguna fila (SBA-61): por
 * eso pasa por `plataforma.resolver_usuario_auth0`, que es `SECURITY DEFINER`.
 */
@Injectable()
export class UsuariosPrismaRepositorio extends UsuariosRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async idPorIdentidad({ emisor, auth0Sub }: IdentidadDeAutenticacion) {
    const filas = await this.prisma.$queryRaw<{ usuarioId: string | null }[]>`
      SELECT plataforma.resolver_usuario_auth0(${emisor}, ${auth0Sub}) AS "usuarioId"
    `;

    return filas[0]?.usuarioId ?? undefined;
  }

  /**
   * Con `app.usuario_id` y sin banco, la política `usuario_rol_propias` deja
   * ver las asignaciones de todos sus bancos. `banco` no tiene RLS: es una
   * tabla global que solo se lee (ADR-07).
   *
   * El filtro es el mismo de `AsignacionesDeUsuario` en core, con el que el
   * guard autoriza: si cambia allá, cambia aquí, o la PWA ofrecería un banco
   * donde la API responde 403.
   */
  async asignacionesActivas(usuarioId: string): Promise<FilaDeAsignacion[]> {
    return executeTransactionWithTenant<FilaDeAsignacion[]>(
      this.prisma,
      async (tx) => {
        const filas = await tx.usuarioRol.findMany({
          where: {
            usuarioId,
            activo: true,
            OR: [{ bancoId: null }, { banco: { is: { activo: true } } }],
          },
          select: {
            bancoId: true,
            institucionId: true,
            rol: { select: { codigo: true } },
            banco: { select: { nombre: true } },
          },
        });
        return filas.map(({ rol, banco, bancoId, institucionId }) => ({
          rol: rol.codigo,
          bancoId,
          bancoNombre: banco?.nombre ?? null,
          institucionId,
        }));
      },
      { usuarioId },
    );
  }

  /**
   * La política de `usuario` deja ver a quien tiene una asignación activa en
   * el banco del contexto (SBA-61); el filtro por banco repite lo que ya hace
   * RLS en `usuario_rol`.
   */
  async delBanco(): Promise<FilaDeUsuarioDelBanco[]> {
    const bancoId = bancoDelContexto();
    return executeTransactionWithTenant<FilaDeUsuarioDelBanco[]>(this.prisma, async (tx) => {
      const filas = await tx.usuarioRol.findMany({
        where: { bancoId, activo: true },
        orderBy: { usuario: { nombre: 'asc' } },
        select: {
          institucionId: true,
          creadoEn: true,
          rol: { select: { codigo: true } },
          usuario: { select: { id: true, nombre: true, email: true } },
        },
      });
      return filas.map(({ rol, usuario, institucionId, creadoEn }) => ({
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: rol.codigo,
        institucionId,
        desde: creadoEn,
      }));
    });
  }

  /** Una entrada de auditoría por asignación desactivada (D16). */
  async desactivarAsignaciones(usuarioId: string): Promise<number> {
    const bancoId = bancoDelContexto();
    return executeTransactionWithTenant<number>(this.prisma, async (tx) => {
      const activas = await tx.usuarioRol.findMany({
        where: { usuarioId, bancoId, activo: true },
        select: { id: true },
      });
      const ids = activas.map((a) => a.id);
      await tx.usuarioRol.updateMany({ where: { id: { in: ids } }, data: { activo: false } });
      for (const id of ids) {
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'usuario_rol',
          entidadId: id,
          detalle: { camposModificados: ['activo'] },
        });
      }
      return ids.length;
    });
  }
}
