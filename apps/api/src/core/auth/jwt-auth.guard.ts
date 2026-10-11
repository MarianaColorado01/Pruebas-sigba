import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RUTA_PUBLICA } from './publico.decorator.js';
import type { IdentidadDeAutenticacion } from './resolutor-de-identidad.js';
import { TOKEN_VERIFIER, type TokenVerifier } from './token-verifier.js';

interface PeticionAutenticable {
  headers: Record<string, string | string[] | undefined>;
  identidad?: IdentidadDeAutenticacion;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublica = this.reflector.getAllAndOverride<boolean>(RUTA_PUBLICA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (esPublica) return true;

    const request = context.switchToHttp().getRequest<PeticionAutenticable>();
    const authorization = request.headers['authorization'];
    const match = typeof authorization === 'string' && /^Bearer ([^\s]+)$/i.exec(authorization);
    if (!match) throw new UnauthorizedException();

    try {
      request.identidad = await this.verifier.verify(match[1]!);
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }
}
