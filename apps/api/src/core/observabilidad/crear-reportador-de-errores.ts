import { ReportadorSentry } from './adapters/sentry/reportador-sentry.js';
import { type ReportadorDeErrores, ReportadorNulo } from './reportador-de-errores.js';

/**
 * Sentry si hay `SENTRY_DSN`; si no, el nulo. Un DSN mal escrito o sin
 * `SENTRY_ENVIRONMENT` rompe el arranque: un error de producción marcado como
 * staging se pierde entre los de prueba.
 */
export function crearReportadorDeErrores(
  entorno: NodeJS.ProcessEnv = process.env,
): ReportadorDeErrores {
  const dsn = entorno['SENTRY_DSN']?.trim();
  if (!dsn) return new ReportadorNulo();
  const ambiente = entorno['SENTRY_ENVIRONMENT']?.trim();
  if (!ambiente) throw new Error('Con SENTRY_DSN configura también SENTRY_ENVIRONMENT.');
  return new ReportadorSentry(dsn, ambiente);
}
