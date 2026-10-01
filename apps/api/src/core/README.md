# core

Infraestructura compartida: autenticación, contexto de tenant, roles, manejo de
errores, logging, outbox, auditoría y los puertos de proveedores
(Arquitectura 5.2).

**`core` no es un módulo de alcance.** Vive al lado de `modules/`, no dentro. La
dependencia va en un solo sentido: los módulos importan `core`; `core` nunca
importa un módulo. El lint lo comprueba y falla si se invierte (ADR-01).

## Qué falta y en qué ticket entra

| Pieza                                                           | Ticket         |
| --------------------------------------------------------------- | -------------- |
| Contexto de tenant (`AsyncLocalStorage`) y RLS por banco        | SBA-6          |
| Guard de JWT y adaptador OIDC de Auth0                          | SBA-8          |
| Roles por banco, `@Roles()` y contexto de petición              | SBA-18         |
| `AuditService` y auditoría base                                 | SBA-21         |
| `EventPublisher` y outbox transaccional                         | SBA-30         |
| Puertos de proveedores: almacenamiento, correo, visión, precios | SBA-13, SBA-54 |

Cada uno entra por PR. `core/` es ruta con CODEOWNER: todo cambio pasa por
revisión de arquitectura (Arquitectura 5.2).
