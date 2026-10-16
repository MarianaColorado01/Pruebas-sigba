import { IsIn, IsString } from 'class-validator';
import { ROLES_INVITABLES_POR_ADMIN, type RolInvitablePorAdmin } from '@sigba/shared-types';

/**
 * Lo que entra por HTTP a las invitaciones (ADR-04). Aquí se comprueban los
 * tipos; forma del correo, espacios y largos los valida el servicio.
 */

/** `super_admin` invita al primer `admin_banco` de un banco (D8). */
export class InvitarAdministradorDto {
  @IsString()
  email!: string;

  @IsString()
  nombre!: string;
}

/** `admin_banco` invita con un rol interno; `institucion` da 400 (D8). */
export class InvitarAlBancoDto extends InvitarAdministradorDto {
  @IsIn(ROLES_INVITABLES_POR_ADMIN)
  rol!: RolInvitablePorAdmin;
}

export class AceptarInvitacionDto {
  @IsString()
  token!: string;
}
