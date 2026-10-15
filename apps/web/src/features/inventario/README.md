# Feature inventario

Pantallas y estado de interfaz del módulo `inventario` (Arquitectura 5.3).

`CatalogoPage` busca referencias por producto, presentación o código del Banco y
las agrupa por categoría. Sin red, busca en la copia local del catálogo.

Consume la API por `src/shared`; los tipos del contrato vienen de
`@sigba/shared-types`. Los componentes que usen dos features o más suben a
`packages/ui`.
