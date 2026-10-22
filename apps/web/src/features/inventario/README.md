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

`precios/PreciosPage` muestra, por referencia, el precio vigente de hoy y el
historial con banda, fuente, evidencia y vigencia (SBA-82). Coordinación y
administración proponen y aprueban; aprobar un valor fuera de la banda pide el
motivo. Sin precio vigente aprobado, avisa que las recepciones quedan con
valoración pendiente (ADR-13).

`SalidaPage` registra la entrega a una institución mientras se despacha
(SBA-38): institución, bodega, y por producto el lote y la cantidad. Sugiere el
lote que vence primero (FEFO) y deja cambiarlo; lo vencido no aparece. Al
confirmar muestra el comprobante operativo con valor comercial y aporte, o
«pendiente» si la referencia no tiene precio aprobado vigente. Todo envío pasa
por `registrarSalida`, con `comandoId` y `movimientoId` generados en el celular:
la cola sin señal la envuelve sin tocar la pantalla. Un 409 `sin_stock` avisa y
vuelve a consultar el stock.

Decisión (SBA-38, SBA-40): la salida se valora con el precio aprobado y el
porcentaje de aporte vigentes el día en que la API recibe el comando, en hora
de Colombia. Un comando que se registró sin señal se valora el día en que
sincroniza, no el día en que se despachó.

Consume la API por `src/shared`; los tipos del contrato vienen de
`@sigba/shared-types`. Los componentes que usen dos features o más suben a
`packages/ui`.
