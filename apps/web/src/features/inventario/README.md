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

`recepcion/RecepcionPage` registra una donación con red (SBA-80): bodega,
origen, donante (lo busca o lo crea sin salir), y por referencia la cantidad, el
lote, el vencimiento y la novedad. Al confirmar, marca «valoración pendiente» en
las filas sin precio vigente aprobado (ADR-13). Todo envío pasa por
`useEnviarRecepcion`: la cola sin señal (ADR-10) se monta ahí, recibe el mismo
comando y devuelve `{ estado: 'pendiente' }` mientras la API no responda.

`bajas/BajasPage` registra bajas por producto no apto y ajustes de inventario
con motivo (SBA-81). El lote se elige del stock del banco con su saldo; la baja
pide uno de los motivos de la lista y el ajuste, si falta o sobra producto y un
motivo escrito. Todo envío pasa por `useRegistrarMovimiento`.

Consume la API por `src/shared`; los tipos del contrato vienen de
`@sigba/shared-types`. Los componentes que usen dos features o más suben a
`packages/ui`.
