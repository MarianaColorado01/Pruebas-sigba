import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { TenantContext } from '../database/tenant-context.js';
import type { ContextoDelError } from './error-reportado.js';

/** Lo que la observabilidad agrega a la petición de Express. */
export interface PeticionObservada extends Request {
  peticionId?: string;
  modulo?: string;
  contextoTenant?: TenantContext;
}

/** El patrón de la ruta, nunca la URL real: la consulta puede llevar un documento. */
function rutaDe(peticion: PeticionObservada): string | undefined {
  const ruta: unknown = peticion.route?.path;
  return typeof ruta === 'string' ? `${peticion.baseUrl}${ruta}` : undefined;
}

export function contextoDe(peticion: PeticionObservada): ContextoDelError {
  const { usuarioId, bancoId } = peticion.contextoTenant ?? {};
  const ruta = rutaDe(peticion);
  return {
    peticionId: peticion.peticionId ?? randomUUID().replaceAll('-', ''),
    metodo: peticion.method,
    ...(ruta ? { ruta } : {}),
    ...(peticion.modulo ? { modulo: peticion.modulo } : {}),
    ...(usuarioId ? { usuarioId } : {}),
    ...(bancoId ? { bancoId } : {}),
  };
}

/**
 * Una línea por petición con identificador, ruta, estado, duración, módulo,
 * usuario interno y banco (RNF-M3-08). No registra cuerpo, cabeceras ni
 * consulta. El identificador vuelve en `X-Request-Id` y en el cuerpo de un 5xx
 * para buscarlo en el log y en Sentry.
 */
export function registrarPeticiones(log = new Logger('Peticion')) {
  return (peticion: PeticionObservada, respuesta: Response, siguiente: NextFunction): void => {
    const inicio = performance.now();
    peticion.peticionId = randomUUID().replaceAll('-', '');
    respuesta.setHeader('X-Request-Id', peticion.peticionId);
    respuesta.on('finish', () => {
      log.log({
        ...contextoDe(peticion),
        estado: respuesta.statusCode,
        duracionMs: Math.round(performance.now() - inicio),
      });
    });
    siguiente();
  };
}
