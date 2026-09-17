# Operación sin señal

Aquí vive la cola local de comandos, la caché versionada del catálogo y la
reconciliación al sincronizar (Arquitectura 5.3 y 8.4, ADR-10).

**Todavía no hay esquema de Dexie, y es a propósito.** La secuencia aceptada en
ADR-10 es: base idempotente en la Iteración 1, libro completo en la 2, cola de
recepción en la 3 y cola de salidas en la 4. Dexie está instalado para que el
esquema entre sin tocar dependencias.

Cuando llegue, la cola guarda cada comando con `comando_id` UUIDv7, banco,
usuario, versión y estado (`pendiente`, `confirmado`, `conflicto`), y respeta el
orden de dependencia al enviar (Arquitectura 6.1).

Un registro local **no confirma inventario en el servidor**. La interfaz debe
decir «pendiente de sincronizar» hasta que la API responda.
