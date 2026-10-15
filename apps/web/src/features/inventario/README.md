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

Consume la API por `src/shared`; los tipos del contrato vienen de
`@sigba/shared-types`. Los componentes que usen dos features o más suben a
`packages/ui`.
