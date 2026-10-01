import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${process.env.AUTH0_ISSUER_URL}.well-known/jwks.json`,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: process.env.AUTH0_AUDIENCE,
      issuer: process.env.AUTH0_ISSUER_URL,
      algorithms: ['RS256'],
    });
  }

  async validate(payload: Record<string, unknown>) {
    const auth0Sub = typeof payload.sub === 'string' ? payload.sub : null;

    if (!auth0Sub) {
      throw new UnauthorizedException('Token JWT sin sub válido');
    }

    const usuario = await this.prisma.usuario.findUnique({
      where: { auth0_sub: auth0Sub },
      select: {
        id: true,
        auth0_sub: true,
        banco_id: true,
      },
    });

    if (!usuario) {
      throw new UnauthorizedException('Usuario autenticado pero no registrado en SIGBA');
    }

    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    const institucionId = typeof payload.institucion_id === 'string' ? payload.institucion_id : null;

    return {
      id: usuario.id,
      auth0_sub: usuario.auth0_sub,
      banco_id: usuario.banco_id,
      roles,
      institucion_id: institucionId,
    };
  }
}