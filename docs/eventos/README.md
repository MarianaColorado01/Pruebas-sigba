# Contratos de eventos

`contratos.v1.json` contiene borradores de los eventos que M1 y M2 planean
escribir en `core.outbox`. Cada esquema valida el sobre (`tipo`, `version` y
`payload`) y rechaza propiedades no declaradas.

La lista de M1 reúne eventos citados en SBA-24, SBA-37, SBA-38, SBA-43 y
SBA-57. El esquema de beneficiarios v5.0 propone cuatro eventos de M2, aunque
SBA-30 cuenta tres. Por eso los cuatro aparecen aquí como borradores.

Los capitanes de arquitectura y de los equipos consumidores aún deben aprobar
los nombres y las cargas. No uses estos esquemas como contratos de producción
hasta recibir esa aprobación.
