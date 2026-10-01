import { Global, Module } from '@nestjs/common';

/**
 * Infraestructura compartida por todos los módulos: conexión a base de datos,
 * guard de JWT, contexto de tenant, guard de roles, manejo de errores, logging,
 * outbox y despachador de eventos, auditoría y puertos de proveedores
 * (Arquitectura 5.2).
 *
 * `core` no es un cuarto módulo de alcance: los módulos dependen de él, nunca
 * al revés. El lint lo comprueba (ADR-01).
 *
 * Está vacío a propósito. Se llena en:
 *   SBA-6  · contexto de tenant y RLS por banco
 *   SBA-8  · adaptador OIDC de Auth0
 *   SBA-18 · roles por banco y guard de roles
 *   SBA-21 · auditoría base
 *   SBA-30 · outbox transaccional
 */
import { AsignacionesDeUsuario } from './autorizacion/asignaciones-de-usuario.js';
import { PrismaService } from './database/prisma.service.js';

@Global()
@Module({
  providers: [PrismaService, AsignacionesDeUsuario],
  exports: [PrismaService, AsignacionesDeUsuario],
})
export class CoreModule {}
