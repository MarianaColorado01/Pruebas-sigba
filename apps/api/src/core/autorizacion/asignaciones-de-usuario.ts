import { Injectable } from '@nestjs/common';
import { ROLES, type Rol } from '@sigba/shared-types';
import { executeTransactionWithTenant } from '../database/prisma-rls.extension.js';
import { PrismaService } from '../database/prisma.service.js';
import type { Asignacion } from './elegir-asignacion.js';

export interface UsuarioConAsignaciones {
  usuarioId: string;
  asignaciones: Asignacion[];
}

type FilaAsignacion = {
  bancoId: string | null;
  institucionId: string | null;
  rol: { codigo: string };
};

const esRol = (codigo: string): codigo is Rol => (ROLES as readonly string[]).includes(codigo);

/**
 * Lee de SIGBA, no del token, qué puede hacer cada usuario (ADR-06): Auth0 dice
 * quién es; los roles, bancos e instituciones viven en `usuario_rol`.
 */
@Injectable()
export class AsignacionesDeUsuario {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asignaciones activas del usuario con ese `sub`, en todos sus bancos.
   * `undefined` si el usuario no existe o está desactivado.
   */
  async deIdentidad(auth0Sub: string): Promise<UsuarioConAsignaciones | undefined> {
    // `usuario` es global y no tiene RLS por banco (ADR-07).
    const usuario = await this.prisma.usuario.findFirst({
      where: { auth0Sub, activo: true },
      select: { id: true },
    });
    if (!usuario) return undefined;

    // Con app.usuario_id y sin banco, la política usuario_rol_propias deja ver
    // las asignaciones de todos sus bancos y la de super_admin, que va sin banco.
    const filas = await executeTransactionWithTenant<FilaAsignacion[]>(
      this.prisma,
      (tx) =>
        tx.usuarioRol.findMany({
          where: {
            usuarioId: usuario.id,
            activo: true,
            OR: [{ bancoId: null }, { banco: { is: { activo: true } } }],
          },
          select: { bancoId: true, institucionId: true, rol: { select: { codigo: true } } },
        }),
      { usuarioId: usuario.id },
    );

    const asignaciones = filas.flatMap(({ rol, bancoId, institucionId }) =>
      esRol(rol.codigo) ? [{ rol: rol.codigo, bancoId, institucionId }] : [],
    );

    return { usuarioId: usuario.id, asignaciones };
  }
}
