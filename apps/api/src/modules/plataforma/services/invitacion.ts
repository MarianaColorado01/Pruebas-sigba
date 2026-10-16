import type { MotivoDeInvitacionRechazada, Rol } from '@sigba/shared-types';
import type { IdentidadDeAutenticacion } from '../../../core/index.js';

/**
 * Invitación a un banco y el puerto por el que se guarda (SBA-19, D4 y D5).
 *
 * Al puerto solo llega el SHA-256 del token: el token viaja en el enlace y en
 * ningún otro lado. El adaptador fija el banco y el actor en la transacción.
 */

export interface NuevaInvitacion {
  bancoId: string;
  email: string;
  nombre: string;
  rol: Rol;
  institucionId: string | null;
  tokenHash: string;
  venceEn: Date;
}

/** Lo que hace falta para escribir el correo de una invitación. */
export interface DestinoDeInvitacion {
  email: string;
  nombre: string;
  bancoNombre: string;
}

/** Una invitación no revocada del banco del contexto. */
export interface FilaDeInvitacion {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  venceEn: Date;
  creadoEn: Date;
  aceptadaEn: Date | null;
  aceptadaPorNombre: string | null;
}

/**
 * Resultado de cambiar una invitación pendiente. `cerrada`: ya se aceptó o se
 * revocó.
 */
export type CambioDeInvitacion = DestinoDeInvitacion | 'no_existe' | 'cerrada';

export type ResultadoDeAceptacion =
  | { resultado: 'aceptada'; bancoId: string; rol: string }
  | { resultado: MotivoDeInvitacionRechazada };

/** El banco de la invitación no existe. */
export class BancoInexistente extends Error {}

/** Ya hay una invitación pendiente para ese correo, con otro rol o institución. */
export class PendienteConOtrosDatos extends Error {}

/**
 * La invitación guardada, o la pendiente que ya existía para ese correo y los
 * mismos datos (`yaExistia`). De esa solo se conoce el hash del token.
 */
export interface InvitacionCreada {
  id: string;
  bancoNombre: string;
  venceEn: Date;
  yaExistia: boolean;
}

export abstract class InvitacionesRepositorio {
  /**
   * Una pendiente por banco y correo: si ya hay una con el mismo rol e
   * institución la devuelve, sin guardar otra.
   * @throws BancoInexistente
   * @throws PendienteConOtrosDatos
   */
  abstract crear(invitacion: NuevaInvitacion): Promise<InvitacionCreada>;

  abstract listar(): Promise<FilaDeInvitacion[]>;

  /** Cambia el token de una pendiente; el anterior deja de servir. */
  abstract renovarToken(id: string, tokenHash: string, venceEn: Date): Promise<CambioDeInvitacion>;

  abstract revocar(id: string): Promise<CambioDeInvitacion>;

  /**
   * Crea o reutiliza el usuario y le da la asignación, todo o nada. La
   * identidad trae el correo verificado con el que se compara el invitado.
   */
  abstract aceptar(
    tokenHash: string,
    identidad: IdentidadDeAutenticacion,
  ): Promise<ResultadoDeAceptacion>;
}
