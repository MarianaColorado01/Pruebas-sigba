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
