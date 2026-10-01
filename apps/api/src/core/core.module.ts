import { Global, Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { JwtStrategy } from './auth/jwt.strategy.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Infraestructura compartida por todos los módulos: conexión a base de datos,
 * guard de JWT, contexto de tenant, guard de roles, manejo de errores, logging,
 * outbox y despachador de eventos, auditoría y puertos de proveedores
 * (Arquitectura 5.2).
 *
 * `core` no es un cuarto módulo de alcance: los módulos dependen de él, nunca
 * al revés. El lint lo comprueba (ADR-01).
 */
@Global()
@Module({
  imports: [PassportModule, PrismaModule],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [PassportModule, JwtAuthGuard, PrismaModule],
})
export class CoreModule {}
