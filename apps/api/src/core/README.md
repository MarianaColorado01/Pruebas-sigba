# core

Infraestructura compartida: autenticación, contexto de tenant, roles, manejo de
errores, logging, outbox, auditoría y los puertos de proveedores
(Arquitectura 5.2).

**`core` no es un módulo de alcance.** Vive al lado de `modules/`, no dentro. La
dependencia va en un solo sentido: los módulos importan `core`; `core` nunca
importa un módulo. El lint lo comprueba y falla si se invierte (ADR-01).

## Estado

- Contexto de tenant (`AsyncLocalStorage`) y RLS por banco: implementado en SBA-6.
  `executeTransactionWithTenant` acepta `{ timeout, maxWait }` como cuarto
  parámetro opcional (SBA-64), ver abajo.
- Guard JWT, puerto `TokenVerifier` y adaptador Auth0: implementado.
- Roles por banco, `@Roles()` y contexto de petición: implementado en SBA-18.
- `AuditService` y auditoría base: SBA-21.
- `IdempotenciaService` y `core.comando_procesado`: SBA-69. Ver
  [docs/arquitectura/idempotencia-de-comandos.md](../../../../docs/arquitectura/idempotencia-de-comandos.md).
- `OutboxService.emitir()` escribe eventos dentro de la transacción del caso de uso: SBA-30.
  Los contratos permanecen en borrador hasta la aprobación de arquitectura y de los equipos
  consumidores.
- Puertos de almacenamiento, correo, visión y precios: SBA-13 y SBA-54.

## Tiempo de una transacción de tenant

`executeTransactionWithTenant(client, fn, contextOverride?, opciones?)` y
`$transactionWithTenant(fn, contextOverride?, opciones?)` pasan `opciones` a
`$transaction` de Prisma. Sin ellas rigen los valores de Prisma: 5 s de
duración (`timeout`) y 2 s de espera por una conexión (`maxWait`). Al vencer el
`timeout`, Prisma revierte la transacción.

```ts
await executeTransactionWithTenant(this.prisma, fn, undefined, { timeout: 30_000 });
```

Sube el `timeout` solo para una tarea larga y conocida: la importación de
códigos (SBA-12) hace hasta 54 `update` en una transacción y contra Neon pide
30 s. Una transacción abierta sostiene bloqueos y una conexión del pool; una
petición HTTP normal no debería necesitarlo.

`core/` es ruta con CODEOWNER: todo cambio pasa por revisión de arquitectura
(Arquitectura 5.2).
