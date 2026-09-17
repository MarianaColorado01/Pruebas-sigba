# ADR-09 · Outbox transaccional y modelos de lectura

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

M2 consume salidas y M3 consume eventos de ambos módulos. Un fallo entre
escritura y publicación no debe perder el evento. El piloto no requiere un
broker externo.

## Decisión

Escribir el outbox en la transacción del dominio mediante un acceso acotado a
`core`. Entregar al menos una vez, con acuse por consumidor, reintentos y lease
para varias réplicas.

Cada consumidor deduplica evento y actualiza su proyección en una transacción.
Versionar contratos y conservar orden por agregado cuando la regla lo exija.

## Consecuencias

Consultar tablas operativas desde reportes acoplaría módulos; un broker desde el
arranque sumaría operación.

La analítica comparte CPU y base con la API, por lo que necesita límites de
concurrencia.

Reconstruir exige retener eventos suficientes o snapshots compatibles con la
política de datos; `procesado_en` por evento no cubre a varios consumidores.
