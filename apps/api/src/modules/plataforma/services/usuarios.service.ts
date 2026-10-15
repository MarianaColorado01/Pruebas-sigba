import { Injectable } from '@nestjs/common';
import { type AsignacionDeUsuario, ROLES, type Rol } from '@sigba/shared-types';
import {
  getTenantContext,
  type IdentidadDeAutenticacion,
  type ResolutorDeIdentidad,
  type UsuarioResuelto,
} from '../../../core/index.js';
import { UsuariosRepositorio } from './usuario.js';

const esRol = (codigo: string): codigo is Rol => (ROLES as readonly string[]).includes(codigo);

@Injectable()
export class UsuariosService implements ResolutorDeIdentidad {
  constructor(private readonly repositorio: UsuariosRepositorio) {}

  async resolverIdentidad(
    identidad: IdentidadDeAutenticacion,
  ): Promise<UsuarioResuelto | undefined> {
    const usuarioId = await this.repositorio.idPorIdentidad(identidad);

    return usuarioId ? { usuarioId } : undefined;
  }

  /**
   * Bancos y roles con que la persona de la sesión puede trabajar (D13). Quien
   * se registró en Auth0 sin invitación no existe en SIGBA y recibe una lista
   * vacía, no un error: la PWA le pide que consiga una invitación.
   *
   * La red va primero; después cada banco por nombre y, dentro del banco, el
   * rol con más precedencia, que es el que la API usa en ese banco.
   */
  async asignacionesPropias(): Promise<AsignacionDeUsuario[]> {
    const usuarioId = getTenantContext()?.usuarioId;
    if (!usuarioId) return [];

    const filas = await this.repositorio.asignacionesActivas(usuarioId);

    return filas
      .flatMap(({ rol, ...resto }) => (esRol(rol) ? [{ rol, ...resto }] : []))
      .sort(
        (a, b) =>
          (a.bancoNombre ?? '').localeCompare(b.bancoNombre ?? '', 'es') ||
          ROLES.indexOf(a.rol) - ROLES.indexOf(b.rol),
      );
  }
}
