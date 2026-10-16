import type { IdentidadDeAutenticacion } from '../../../core/index.js';

/**
 * Una fila de `usuario_rol` con el nombre de su banco. El rol llega como el
 * código que guarda la base; el servicio descarta los que no son del contrato.
 */
export interface FilaDeAsignacion {
  rol: string;
  bancoId: string | null;
  bancoNombre: string | null;
  institucionId: string | null;
}

/** Una asignación activa en el banco del contexto, con su persona. */
export interface FilaDeUsuarioDelBanco {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: string;
  institucionId: string | null;
  desde: Date;
}

/**
 * Puerto por el que se busca un usuario por su identidad de Auth0 (SBA-8) y
 * se leen y desactivan asignaciones (SBA-19). El adaptador de Prisma vive en
 * `repositories/`: `services/` no importa el SDK (RNF-03).
 */
export abstract class UsuariosRepositorio {
  /** Id del usuario activo con ese emisor y `sub`, o `undefined`. */
  abstract idPorIdentidad(identidad: IdentidadDeAutenticacion): Promise<string | undefined>;

  /** Asignaciones activas del usuario, solo de bancos activos o sin banco. */
  abstract asignacionesActivas(usuarioId: string): Promise<FilaDeAsignacion[]>;

  /** Asignaciones activas del banco del contexto. */
  abstract delBanco(): Promise<FilaDeUsuarioDelBanco[]>;

  /**
   * Desactiva las asignaciones del usuario en el banco del contexto (D15) y
   * devuelve cuántas eran.
   */
  abstract desactivarAsignaciones(usuarioId: string): Promise<number>;
}
