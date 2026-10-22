# Feature inventario

Pantallas y estado de interfaz del módulo `inventario` (Arquitectura 5.3).

`CatalogoPage` busca referencias por producto, presentación o código del Banco y
las agrupa por categoría. Sin red, busca en la copia local del catálogo.

`StockPage` muestra lo que hay en cada bodega y en qué lote, con vencimiento y
estado, filtrado por bodega, categoría y referencia (SBA-36). Trae todo el stock
del banco y filtra en pantalla, para que los filtros sirvan sin red sobre la
última copia. Muestra siempre la hora de la última sincronización del
dispositivo. Mientras SBA-34 no exponga el nombre de las bodegas, se ve el
comienzo de su id.

Cada lote vigente lleva el semáforo que calcula la API con los umbrales del
banco (SBA-37), y arriba va la salida prioritaria: lo que sale hoy (rojo), esta
semana (amarillo) y este mes (verde a 30 días o menos), lo que vence primero
arriba. Sin red se recalculan los días y lo vencido; el color queda el último
que dio la API, porque los umbrales viven allá.

Consume la API por `src/shared`; los tipos del contrato vienen de
`@sigba/shared-types`. Los componentes que usen dos features o más suben a
`packages/ui`.
