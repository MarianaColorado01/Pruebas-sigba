# Operación sin señal

Aquí vive la cola local de comandos, la caché versionada del catálogo y la
reconciliación al sincronizar (Arquitectura 5.3 y 8.4, ADR-10).

`catalogoDb.ts` guarda una copia del catálogo por banco con su ETag (SBA-22). La
pantalla la valida al abrir y avisa «posiblemente desactualizado» mientras
muestra la copia sin confirmar con la API. El catálogo no trae datos personales.

`stockDb.ts` guarda, por banco, el último stock que respondió la API y la hora
en que lo recibió el dispositivo (SBA-36). Vive en su propia base, `sigba-stock`,
para no tocar el esquema de `sigba-offline`. Tampoco trae datos personales.

La cola de comandos todavía no existe. La secuencia aceptada en ADR-10 es: base
idempotente en la Iteración 1, libro completo en la 2, cola de recepción en la 3
y cola de salidas en la 4.

Cuando llegue, la cola guarda cada comando con `comando_id` UUIDv7, banco,
usuario, versión y estado (`pendiente`, `confirmado`, `conflicto`), y respeta el
orden de dependencia al enviar (Arquitectura 6.1).

Un registro local **no confirma inventario en el servidor**. La interfaz debe
decir «pendiente de sincronizar» hasta que la API responda.
