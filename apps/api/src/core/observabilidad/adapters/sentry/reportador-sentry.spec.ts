import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorReportado } from '../../error-reportado.js';
import { ReportadorSentry } from './reportador-sentry.js';

const dsn = 'https://clavepublica@o1.ingest.us.sentry.io/42';

const error: ErrorReportado = {
  peticionId: 'a'.repeat(32),
  nombre: 'Error',
  mensaje: 'falló la consulta',
  marcos: [
    'at Servicio.registrar (/app/dist/modules/inventario/servicio.js:10:5)',
    'at node:internal/process:1:1',
  ],
  metodo: 'POST',
  ruta: '/api/v1/recepciones',
  modulo: 'inventario',
  usuarioId: 'u-1',
  bancoId: 'b-1',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function lineasEnviadas(enviar: ReturnType<typeof vi.fn>): unknown[] {
  const [, opciones] = enviar.mock.calls[0] as [string, RequestInit];
  return String(opciones.body)
    .split('\n')
    .map((linea) => JSON.parse(linea) as unknown);
}

describe('ReportadorSentry', () => {
  it('manda un envelope al proyecto del DSN con la clave en X-Sentry-Auth', () => {
    const enviar = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    new ReportadorSentry(dsn, 'staging', enviar).reportar(error);

    const [destino, opciones] = enviar.mock.calls[0] as [string, RequestInit];
    expect(destino).toBe('https://o1.ingest.us.sentry.io/api/42/envelope/');
    expect((opciones.headers as Record<string, string>)['X-Sentry-Auth']).toContain(
      'sentry_key=clavepublica',
    );
  });

  it('el evento lleva el peticionId, la ruta como patrón y la pila en orden de Sentry', () => {
    const enviar = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));

    new ReportadorSentry(dsn, 'staging', enviar).reportar(error);

    const [, , evento] = lineasEnviadas(enviar);
    expect(evento).toMatchObject({
      event_id: error.peticionId,
      environment: 'staging',
      transaction: 'POST /api/v1/recepciones',
      tags: { peticion_id: error.peticionId, modulo: 'inventario', banco_id: 'b-1' },
      user: { id: 'u-1' },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'falló la consulta',
            stacktrace: {
              frames: [
                { filename: 'node:internal/process', lineno: 1, in_app: false },
                {
                  function: 'Servicio.registrar',
                  filename: '/app/dist/modules/inventario/servicio.js',
                  lineno: 10,
                  colno: 5,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    });
    expect(Object.keys(evento as object)).not.toContain('request');
  });

  it('si Sentry falla, solo deja un aviso en el log', async () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const enviar = vi.fn().mockRejectedValue(new Error('sin red'));

    expect(() => new ReportadorSentry(dsn, 'staging', enviar).reportar(error)).not.toThrow();
    await vi.waitFor(() =>
      expect(aviso).toHaveBeenCalledWith('No se pudo enviar un error a Sentry.'),
    );
  });

  it('tras un 429 no manda nada hasta que pase el Retry-After', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const enviar = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429, headers: { 'Retry-After': '30' } }));
    const reportador = new ReportadorSentry(dsn, 'staging', enviar);

    reportador.reportar(error);
    await vi.waitFor(() => expect(Logger.prototype.warn).toHaveBeenCalled());
    reportador.reportar(error);

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('rechaza un DSN sin clave, sin proyecto o sin HTTPS', () => {
    expect(() => new ReportadorSentry('https://o1.ingest.sentry.io/42', 'staging')).toThrow();
    expect(() => new ReportadorSentry('https://clave@o1.ingest.sentry.io/', 'staging')).toThrow();
    expect(() => new ReportadorSentry('http://clave@o1.ingest.sentry.io/42', 'staging')).toThrow();
  });
});
