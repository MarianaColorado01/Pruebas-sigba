import { Logger } from '@nestjs/common';
import type { ErrorReportado } from '../../error-reportado.js';
import { ReportadorDeErrores } from '../../reportador-de-errores.js';

interface Marco {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const MARCO = /^at (?:(.+?) \()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/;

function aMarco(linea: string): Marco | undefined {
  const partes = MARCO.exec(linea);
  if (!partes?.[2]) return undefined;
  const [, funcion, archivo, numero, columna] = partes;
  return {
    ...(funcion ? { function: funcion } : {}),
    filename: archivo,
    ...(numero ? { lineno: Number(numero) } : {}),
    ...(columna ? { colno: Number(columna) } : {}),
    in_app: !archivo.includes('node_modules') && !archivo.startsWith('node:'),
  };
}

/**
 * Manda el error a Sentry por su API HTTP de envelopes, sin el SDK (ADR-11).
 * Solo viaja lo que trae `ErrorReportado`, que ya llega depurado: ni cuerpo,
 * ni cabeceras, ni IP, ni la URL real.
 */
export class ReportadorSentry extends ReportadorDeErrores {
  private readonly log = new Logger(ReportadorSentry.name);
  private readonly destino: string;
  private readonly autorizacion: string;
  /** Con un 429, Sentry dice hasta cuándo no recibe; antes de eso se descarta. */
  private pausaHasta = 0;

  constructor(
    private readonly dsn: string,
    private readonly entorno: string,
    private readonly enviar: typeof fetch = fetch,
  ) {
    super();
    const url = new URL(dsn);
    const proyecto = url.pathname.split('/').pop();
    if (url.protocol !== 'https:' || !url.username || !proyecto) {
      throw new Error('SENTRY_DSN debe tener la forma https://<clave>@<host>/<proyecto>');
    }
    const prefijo = url.pathname.slice(0, url.pathname.lastIndexOf('/'));
    this.destino = `${url.origin}${prefijo}/api/${proyecto}/envelope/`;
    this.autorizacion = `Sentry sentry_version=7, sentry_key=${url.username}, sentry_client=sigba-api/1`;
  }

  reportar(error: ErrorReportado): void {
    if (Date.now() < this.pausaHasta) return;
    const evento = {
      event_id: error.peticionId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      environment: this.entorno,
      transaction: `${error.metodo} ${error.ruta ?? '(sin ruta)'}`,
      tags: {
        peticion_id: error.peticionId,
        ...(error.modulo ? { modulo: error.modulo } : {}),
        ...(error.bancoId ? { banco_id: error.bancoId } : {}),
      },
      ...(error.usuarioId ? { user: { id: error.usuarioId } } : {}),
      exception: {
        values: [
          {
            type: error.nombre,
            value: error.mensaje,
            stacktrace: {
              frames: error.marcos
                .map(aMarco)
                .filter((marco) => marco !== undefined)
                .reverse(),
            },
          },
        ],
      },
    };
    const cuerpo = [
      JSON.stringify({
        event_id: error.peticionId,
        sent_at: new Date().toISOString(),
        dsn: this.dsn,
      }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(evento),
    ].join('\n');

    this.enviar(this.destino, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': this.autorizacion,
      },
      body: cuerpo,
      signal: AbortSignal.timeout(5000),
    })
      .then((respuesta) => {
        if (respuesta.status === 429) {
          const segundos = Number(respuesta.headers.get('Retry-After')) || 60;
          this.pausaHasta = Date.now() + segundos * 1000;
          this.log.warn(
            `Sentry pidió esperar ${segundos} s; hasta entonces no se reportan errores.`,
          );
        } else if (!respuesta.ok) {
          this.log.warn(`Sentry respondió ${respuesta.status}.`);
        }
      })
      .catch(() => this.log.warn('No se pudo enviar un error a Sentry.'));
  }
}
