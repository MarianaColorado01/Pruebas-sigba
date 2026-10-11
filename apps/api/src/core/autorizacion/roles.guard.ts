import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CABECERAS, type Rol } from '@sigba/shared-types';
import { RUTA_PUBLICA } from '../auth/publico.decorator.js';
import type { IdentidadDeAutenticacion } from '../auth/resolutor-de-identidad.js';
import type { TenantContext } from '../database/tenant-context.js';
import { AsignacionesDeUsuario } from './asignaciones-de-usuario.js';
import { elegirAsignacion } from './elegir-asignacion.js';

/** Metadato donde `@Roles()` deja los roles permitidos. */
export const ROLES_PERMITIDOS = 'sigba:roles-permitidos';

/** Lo que el guard de roles lee y escribe. `identidad` la deja `JwtAuthGuard`. */
export interface PeticionAutorizada {
  headers: Record<string, string | string[] | undefined>;
  identidad?: IdentidadDeAutenticacion;
  contextoTenant?: TenantContext;
}

function cabecera(peticion: PeticionAutorizada, nombre: string): string | undefined {
  const valor = peticion.headers[nombre];
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Autoriza por rol dentro del banco pedido y deja listo el contexto de tenant
 * que `ContextoDeTenantInterceptor` pone alrededor del controlador
 * (Arquitectura 8.2, RF-M3-02).
 *
 * El banco de la cabecera no se cree: solo selecciona entre las asignaciones
 * del propio usuario. Pedir un banco donde no tiene rol da 403, igual que no
 * tener el rol.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly asignaciones: AsignacionesDeUsuario,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const peticion = contexto.switchToHttp().getRequest<PeticionAutorizada>();

    if (
      this.reflector.getAllAndOverride<boolean>(RUTA_PUBLICA, [
        contexto.getHandler(),
        contexto.getClass(),
      ])
    ) {
      return true;
    }

    const permitidos =
      this.reflector.getAllAndOverride<readonly Rol[] | undefined>(ROLES_PERMITIDOS, [
        contexto.getHandler(),
        contexto.getClass(),
      ]) ?? [];

    if (!peticion.identidad) throw new UnauthorizedException();

    const usuario = await this.asignaciones.deIdentidad(
      peticion.identidad.auth0Sub,
      peticion.identidad.emisor,
    );
    const elegida =
      usuario &&
      elegirAsignacion(
        usuario.asignaciones,
        permitidos,
        cabecera(peticion, CABECERAS.banco),
        cabecera(peticion, CABECERAS.institucion),
      );
    if (!usuario || !elegida) throw new ForbiddenException();

    peticion.contextoTenant = {
      usuarioId: usuario.usuarioId,
      rol: elegida.rol,
      bancoId: elegida.bancoId ?? undefined,
      institucionId: elegida.institucionId ?? undefined,
    };
    return true;
  }
}
