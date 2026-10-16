export const RESOLUTOR_DE_IDENTIDAD = Symbol('RESOLUTOR_DE_IDENTIDAD');

export interface IdentidadDeAutenticacion {
  auth0Sub: string;
  emisor: string;
  /** Correo del token, solo si la Action de Auth0 lo incluye (auth0-setup.md). */
  email?: string;
  /** `true` solo si el token lo trae verdadero; ausente o falso no prueba nada. */
  emailVerificado?: boolean;
}

export interface UsuarioResuelto {
  usuarioId: string;
}

export interface ResolutorDeIdentidad {
  resolverIdentidad(identidad: IdentidadDeAutenticacion): Promise<UsuarioResuelto | undefined>;
}
