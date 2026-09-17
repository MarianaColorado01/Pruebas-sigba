# ADR-08 · Libro de movimientos append-only con identificadores del cliente

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

El celular reenvía comandos y una recepción contiene varios detalles. Un UUID de
comando no identifica todas las filas de movimiento. Un índice `UNIQUE` tampoco
impide cantidades negativas [F12].

## Decisión

Mantener `movimiento` append-only con id por detalle y `comando_id`. Registrar
clave idempotente por banco y hash de carga.

El stock usa una tabla de saldos derivada con bloqueo por banco, bodega y lote,
actualización condicional y `CHECK` no negativo, en la misma transacción del
movimiento, auditoría y outbox.

## Consecuencias

La proyección acelera consultas y el libro permite reconstruirla.

Una tabla de stock editable pierde la evidencia de cambios. Una vista
materializada completa necesita refresco y no sustituye el control transaccional
por lote.

Pruebas concurrentes deben demostrar que saldos, movimientos y outbox confirman
o revierten juntos.
