# core

Infraestructura compartida: autenticación, contexto de tenant, roles, manejo de
errores, logging, outbox, auditoría y los puertos de proveedores
(Arquitectura 5.2).

**`core` no es un módulo de alcance.** Vive al lado de `modules/`, no dentro. La
dependencia va en un solo sentido: los módulos importan `core`; `core` nunca
importa un módulo. El lint lo comprueba y falla si se invierte (ADR-01).

## Estado

- Contexto de tenant (`AsyncLocalStorage`) y RLS por banco: implementado en SBA-6.
- Guard JWT, puerto `TokenVerifier` y adaptador Auth0: implementado.
- Roles por banco, `@Roles()` y contexto de petición: implementado en SBA-18.
- `AuditService` y auditoría base: SBA-21.
- `IdempotenciaService` y `core.comando_procesado`: SBA-69. Ver
  [docs/arquitectura/idempotencia-de-comandos.md](../../../../docs/arquitectura/idempotencia-de-comandos.md).
- `OutboxService.emitir()` escribe eventos dentro de la transacción del caso de uso: SBA-30.
  Los contratos permanecen en borrador hasta la aprobación de arquitectura y de los equipos
  consumidores.
- Puertos de almacenamiento, correo, visión y precios: SBA-13 y SBA-54.

`core/` es ruta con CODEOWNER: todo cambio pasa por revisión de arquitectura
(Arquitectura 5.2).
