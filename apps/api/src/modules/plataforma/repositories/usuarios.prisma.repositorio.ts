import { Injectable } from '@nestjs/common';
import { PrismaService, type IdentidadDeAutenticacion } from '../../../core/index.js';
import { UsuariosRepositorio } from '../services/usuario.js';

/**
 * Adaptador de Prisma para buscar usuarios por identidad. Corre antes de que
 * exista contexto de tenant, y `usuario` tiene RLS sin política para el rol de
 * la API: por eso pasa por `plataforma.resolver_usuario_auth0`, que es
 * `SECURITY DEFINER`, y no lee la tabla.
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
}
