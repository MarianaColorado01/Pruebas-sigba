/**
 * API pública de `analitica` (Arquitectura 5.2).
 *
 * Solo endpoints HTTP: **ningún módulo depende de analitica**. Alimenta sus
 * modelos de lectura consumiendo eventos de los demás módulos, nunca
 * consultando sus tablas (ADR-09).
 *
 * El lint falla si otro módulo lo importa.
 */

export { AnaliticaModule } from './analitica.module.js';
