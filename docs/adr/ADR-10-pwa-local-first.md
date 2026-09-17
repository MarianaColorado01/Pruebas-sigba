# ADR-10 · PWA local-first para recepción y salida

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

La señal de bodega es inestable. Dos celulares pueden despachar existencias que
ambos ven en caché. La captura local conserva evidencia, pero no confirma stock
en el servidor.

## Decisión

IndexedDB conserva comandos por usuario y banco, con dependencias y estados
`pendiente`, `confirmado` y `conflicto`. La API valida sesión, permisos,
idempotencia y stock al sincronizar. La foto espera red para extracción.

Secuencia aceptada: base idempotente en Iteración 1, libro completo en la 2,
cola de recepción en la 3 y de salidas en la 4.

## Consecuencias

Exigir señal incumpliría la necesidad operativa; la aplicación nativa queda
fuera.

El navegador puede perder datos y una sesión revocada bloquea el envío.

El protocolo aceptado asigna cupos o un responsable por lote y conserva una cola
de conflictos. El Banco concreta cupos y responsables antes de probar despachos
sin señal.

La coordinación concilia con evidencia; un rechazo no borra una entrega física.
