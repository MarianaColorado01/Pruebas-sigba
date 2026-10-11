export const RESOLUTOR_DE_IDENTIDAD = Symbol('RESOLUTOR_DE_IDENTIDAD');

export interface IdentidadDeAutenticacion {
  auth0Sub: string;
  emisor: string;
}

export interface UsuarioResuelto {
  usuarioId: string;
}

export interface ResolutorDeIdentidad {
  resolverIdentidad(identidad: IdentidadDeAutenticacion): Promise<UsuarioResuelto | undefined>;
}
