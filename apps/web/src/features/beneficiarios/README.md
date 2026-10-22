# Feature beneficiarios

Pantallas y estado de interfaz del módulo `beneficiarios` (Arquitectura 5.3).

Consume la API por `src/shared`; los tipos del contrato vienen de
`@sigba/shared-types`. Los componentes que usen dos features o más suben a
`packages/ui`.

El registro nominal (`PantallaRegistro`, SBA-78) funciona solo en línea. Los datos de
la persona viven en el estado del formulario: no van a la caché de consultas, a
IndexedDB ni a localStorage, y los errores nunca muestran el `message` de la API
(Arquitectura 8.6).
