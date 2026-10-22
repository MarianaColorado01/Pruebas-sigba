import type { ErrorReportado } from './error-reportado.js';

/**
 * Puerto de reporte de errores (RNF-M3-08, ADR-11). Sentry vive detrás de él;
 * el resto de la API no conoce al proveedor.
 */
export abstract class ReportadorDeErrores {
  /** No espera la respuesta del proveedor y nunca lanza. */
  abstract reportar(error: ErrorReportado): void;
}

/** Sin `SENTRY_DSN` los errores solo quedan en el log. */
export class ReportadorNulo extends ReportadorDeErrores {
  reportar(): void {}
}
