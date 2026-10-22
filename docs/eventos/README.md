# Contratos de eventos

`contratos.v1.json` contiene borradores de los eventos que M1 y M2 planean
escribir en `core.outbox`. Cada esquema valida el sobre (`tipo`, `version` y
`payload`) y rechaza propiedades no declaradas.

La lista de M1 reúne eventos citados en SBA-24, SBA-37, SBA-38, SBA-43 y
SBA-57. El esquema de beneficiarios v5.0 propone cuatro eventos de M2, aunque
SBA-30 cuenta tres. Por eso los cuatro aparecen aquí como borradores.

Desde el 21 de octubre de 2026 cinco de ellos son v1 y tienen tipo en
`@sigba/shared-types` (SBA-88): `RecepcionConfirmada`, `PrecioActualizado`,
`SalidaRegistrada`, `MembresiaActivada` y `MembresiaCerrada`.
`apps/api/test/contratos-eventos.spec.ts` valida contra el esquema un ejemplo
escrito con cada tipo. `OutboxService.emitir` recibe cualquier
`EventoDeDominio`, así que el compilador solo revisa la carga si el emisor la
marca con `satisfies` y el tipo. Cambiar una carga pide acuerdo del emisor,
de los consumidores y de arquitectura, y se hace en el esquema y en el tipo a
la vez.

SBA-74 amplió dos cargas antes de que nadie las consumiera, para que el
reporte de ingresos de M3 salga de eventos (ADR-09): cada detalle de
`RecepcionConfirmada` lleva categoría, kilos, valor unitario e importe (`null`
si la valoración quedó pendiente, ADR-13), y `PrecioActualizado` lleva las
entradas que valoró tarde y su vigencia como día. El origen va en minúsculas,
como en la base (`abaco`).

`LoteProximoAVencer`, `TrasladoConfirmado` y las dos alertas de duplicidad
siguen en borrador hasta que alguien los emita.
