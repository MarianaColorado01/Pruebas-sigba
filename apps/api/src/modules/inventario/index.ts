/**
 * API pública de `inventario` (Arquitectura 5.2).
 *
 * Expondrá `ReferenciasService` y `StockService` (lectura), y los eventos
 * `RecepcionConfirmada`, `SalidaRegistrada`, `TrasladoConfirmado`,
 * `LoteProximoAVencer` y `PrecioActualizado`.
 *
 * Los demás módulos importan de aquí, nunca de sus carpetas internas.
 */

export { InventarioModule } from './inventario.module.js';

// Lo usa el comando de consola `importar-codigos` (SBA-12), que corre fuera del
// módulo. Ningún otro módulo lo necesita.
export {
  ArchivoDeCodigosInvalido,
  ImportacionCatalogoService,
} from './services/importacion-catalogo.service.js';
export type { ReporteDeImportacion } from './services/importacion-catalogo.service.js';

// Los demás módulos consultan el catálogo por aquí (SBA-22).
export { ReferenciasService } from './services/referencias.service.js';
export type {
  CatalogoVersionado,
  FiltroDeReferencias,
  NuevaCategoria,
  NuevaReferencia,
  NuevoProducto,
} from './services/referencias.service.js';
export type {
  Categoria,
  CategoriaDelCatalogo,
  Producto,
  ReferenciaDelCatalogo,
} from './services/referencia.js';
