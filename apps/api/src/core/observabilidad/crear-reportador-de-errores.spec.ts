import { describe, expect, it } from 'vitest';
import { ReportadorSentry } from './adapters/sentry/reportador-sentry.js';
import { crearReportadorDeErrores } from './crear-reportador-de-errores.js';
import { ReportadorNulo } from './reportador-de-errores.js';

describe('crearReportadorDeErrores', () => {
  it('sin SENTRY_DSN usa el nulo', () => {
    expect(crearReportadorDeErrores({})).toBeInstanceOf(ReportadorNulo);
    expect(crearReportadorDeErrores({ SENTRY_DSN: ' ' })).toBeInstanceOf(ReportadorNulo);
  });

  it('con SENTRY_DSN y SENTRY_ENVIRONMENT usa Sentry', () => {
    expect(
      crearReportadorDeErrores({
        SENTRY_DSN: 'https://clave@o1.ingest.sentry.io/42',
        SENTRY_ENVIRONMENT: 'staging',
      }),
    ).toBeInstanceOf(ReportadorSentry);
  });

  it('con SENTRY_DSN y sin SENTRY_ENVIRONMENT no arranca', () => {
    expect(() =>
      crearReportadorDeErrores({ SENTRY_DSN: 'https://clave@o1.ingest.sentry.io/42' }),
    ).toThrow('SENTRY_ENVIRONMENT');
  });
});
