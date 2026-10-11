import type { IdentidadDeAutenticacion } from '../../../core/index.js';

/**
 * Puerto por el que se busca un usuario por su identidad de Auth0 (SBA-8).
 * El adaptador de Prisma vive en `repositories/`: `services/` no importa el
 * SDK (RNF-03).
 */
export abstract class UsuariosRepositorio {
  /** Id del usuario activo con ese emisor y `sub`, o `undefined`. */
  abstract idPorIdentidad(identidad: IdentidadDeAutenticacion): Promise<string | undefined>;
}
