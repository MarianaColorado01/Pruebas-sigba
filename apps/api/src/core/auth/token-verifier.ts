import type { IdentidadDeAutenticacion } from './resolutor-de-identidad.js';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface TokenVerifier {
  verify(token: string): Promise<IdentidadDeAutenticacion>;
}
