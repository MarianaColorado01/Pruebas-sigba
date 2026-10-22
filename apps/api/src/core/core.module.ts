import { Global, Module } from '@nestjs/common';
import { cargarConfiguracionAuth0 } from './auth/auth0-config.js';
import { Auth0TokenVerifier } from './auth/adapters/auth0/auth0-token-verifier.js';
import { TOKEN_VERIFIER } from './auth/token-verifier.js';

/**
 * Infraestructura compartida por todos los módulos: conexión a base de datos,
 * guard de JWT, contexto de tenant, guard de roles, manejo de errores, logging,
 * outbox y despachador de eventos, auditoría y puertos de proveedores
 * (Arquitectura 5.2).
 *
 * `core` no es un cuarto módulo de alcance: los módulos dependen de él, nunca
 * al revés. El lint lo comprueba (ADR-01).
 *
 * Implementa autenticación OIDC y comparte la conexión a base de datos. La
 * autorización y el resolutor de identidad se componen desde AppModule.
 */
import { AuditService } from './auditoria/audit.service.js';
import { crearEnviadorDeCorreo } from './correo/crear-enviador-de-correo.js';
import { EnviadorDeCorreo } from './correo/enviador-de-correo.js';
import { PrismaService } from './database/prisma.service.js';
import { IdempotenciaService } from './idempotencia/idempotencia.service.js';
import { DespachadorDeEventos } from './outbox/despachador.service.js';
import { OutboxService } from './outbox/outbox.service.js';

@Global()
@Module({
  providers: [
    PrismaService,
    AuditService,
    IdempotenciaService,
    OutboxService,
    DespachadorDeEventos,
    { provide: EnviadorDeCorreo, useFactory: () => crearEnviadorDeCorreo() },
    {
      provide: TOKEN_VERIFIER,
      useFactory: () => new Auth0TokenVerifier(cargarConfiguracionAuth0()),
    },
  ],
  exports: [
    PrismaService,
    AuditService,
    IdempotenciaService,
    OutboxService,
    DespachadorDeEventos,
    EnviadorDeCorreo,
    TOKEN_VERIFIER,
  ],
})
export class CoreModule {}
