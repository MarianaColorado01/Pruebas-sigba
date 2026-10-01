# Registros de decisión de arquitectura

Uno por archivo, extraídos del anexo A del Documento de Arquitectura v1.2
(10 de septiembre de 2026). Cada uno conserva contexto, decisión y consecuencias.
Los puntos abiertos mantienen su marca `[por verificar]`.

| ADR                                                              | Decisión                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [ADR-01](ADR-01-monolito-modular.md)                             | Monolito modular                                                                                                    |
| [ADR-02](ADR-02-pwa-separada-de-la-api.md)                       | PWA separada de la API                                                                                              |
| [ADR-03](ADR-03-monorepo-con-pnpm.md)                            | Monorepo con pnpm                                                                                                   |
| [ADR-04](ADR-04-typescript-de-extremo-a-extremo.md)              | TypeScript de extremo a extremo                                                                                     |
| [ADR-05](ADR-05-postgresql-con-prisma-y-un-schema-por-modulo.md) | PostgreSQL con Prisma y un schema por módulo                                                                        |
| [ADR-06](ADR-06-auth0-para-identidad-autorizacion-propia.md)     | Auth0 para identidad, autorización propia                                                                           |
| [ADR-07](ADR-07-tenant-por-banco-con-rls-y-entidad-red.md)       | Tenant por banco con RLS desde la Iteración 0 y entidad red                                                         |
| [ADR-08](ADR-08-libro-de-movimientos-append-only.md)             | Libro de movimientos append-only con identificadores del cliente                                                    |
| [ADR-09](ADR-09-outbox-transaccional-y-modelos-de-lectura.md)    | Outbox transaccional y modelos de lectura                                                                           |
| [ADR-10](ADR-10-pwa-local-first.md)                              | PWA local-first para recepción y salida                                                                             |
| [ADR-11](ADR-11-fly-neon-cloudflare-sin-sdk-de-proveedor.md)     | Fly.io, Neon y Cloudflare sin SDK de proveedor                                                                      |
| [ADR-12](ADR-12-lectura-de-la-foto-detras-de-un-puerto.md)       | Lectura de la foto del cuaderno detrás de un puerto                                                                 |
| [ADR-13](ADR-13-maestro-de-precios-con-varias-fuentes.md)        | Maestro de precios con varias fuentes y aprobación mensual                                                          |
| [ADR-14](ADR-14-salidas-en-inventario.md)                        | Salidas en inventario; beneficiarios sin movimientos                                                                |
| [ADR-15](ADR-15-persona-normalizada-con-documento-cifrado.md)    | Persona normalizada en beneficiarios, con documento cifrado y HMAC por banco antes del primer dato real (propuesto) |

## Cómo añadir uno

Copia la forma de cualquiera de los anteriores: contexto, decisión,
consecuencias y las alternativas que se descartaron con su razón. Un ADR nuevo
entra por PR y lo revisan los tres capitanes (`CODEOWNERS`).

Una decisión que reemplaza a otra no la borra: marca la anterior como
`reemplazada por ADR-NN` y deja el porqué. El valor de estos documentos está en
poder reconstruir el razonamiento dentro de un año.
