import {
  type ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { describirError } from './error-reportado.js';
import { contextoDe, type PeticionObservada } from './registrar-peticiones.js';
import { ReportadorDeErrores } from './reportador-de-errores.js';

/**
 * Un 4xx sigue como lo responde Nest. Todo 5xx va al log y a Sentry
 * (RNF-M3-08). Un 5xx lanzado a propósito con `HttpException` responde su
 * propio mensaje; uno inesperado responde solo el `peticionId`: ni el mensaje
 * ni la pila llegan al navegador (Arquitectura 8.6).
 */
@Catch()
export class FiltroDeErrores extends BaseExceptionFilter {
  private readonly log = new Logger('Error');

  // Sin adaptador: como APP_FILTER, Nest le inyecta el suyo a BaseExceptionFilter.
  constructor(@Inject(ReportadorDeErrores) private readonly reportador: ReportadorDeErrores) {
    super();
  }

  override catch(error: unknown, host: ArgumentsHost): void {
    const estado =
      error instanceof HttpException ? error.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (estado < 500) return super.catch(error, host);

    const http = host.switchToHttp();
    const reporte = describirError(error, contextoDe(http.getRequest<PeticionObservada>()));
    this.log.error(reporte);
    this.reportador.reportar(reporte);

    const respuesta = http.getResponse<Response>();
    // Un flujo que falla a mitad ya mandó las cabeceras: solo queda cortarlo.
    if (respuesta.headersSent) {
      respuesta.end();
      return;
    }
    if (error instanceof HttpException) return super.catch(error, host);
    respuesta.status(estado).json({
      statusCode: estado,
      message: 'Error interno del servidor',
      peticionId: reporte.peticionId,
    });
  }
}
