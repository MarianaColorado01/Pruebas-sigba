import { Injectable } from '@nestjs/common';
import type {
  IdentidadDeAutenticacion,
  ResolutorDeIdentidad,
  UsuarioResuelto,
} from '../../../core/index.js';
import { UsuariosRepositorio } from './usuario.js';

@Injectable()
export class UsuariosService implements ResolutorDeIdentidad {
  constructor(private readonly repositorio: UsuariosRepositorio) {}

  async resolverIdentidad(
    identidad: IdentidadDeAutenticacion,
  ): Promise<UsuarioResuelto | undefined> {
    const usuarioId = await this.repositorio.idPorIdentidad(identidad);

    return usuarioId ? { usuarioId } : undefined;
  }
}
