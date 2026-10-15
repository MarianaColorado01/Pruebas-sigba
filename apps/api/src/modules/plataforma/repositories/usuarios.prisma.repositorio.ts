import { Injectable } from '@nestjs/common';
import {
  executeTransactionWithTenant,
  PrismaService,
  type IdentidadDeAutenticacion,
} from '../../../core/index.js';
import { type FilaDeAsignacion, UsuariosRepositorio } from '../services/usuario.js';

/**
 * Adaptador de Prisma para buscar usuarios y sus asignaciones.
 *
 * La búsqueda por identidad corre antes de que exista contexto de tenant, y
 * `usuario` tiene RLS sin política para el rol de la API: por eso pasa por
 * `plataforma.resolver_usuario_auth0`, que es `SECURITY DEFINER`, y no lee la
 * tabla.
 */
@Injectable()
export class UsuariosPrismaRepositorio extends UsuariosRepositorio {
  constructor(private readonly prisma: PrismaService) {
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
}
