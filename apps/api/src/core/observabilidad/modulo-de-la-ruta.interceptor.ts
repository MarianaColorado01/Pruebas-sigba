import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { PeticionObservada } from './registrar-peticiones.js';

/**
 * Anota en la petición el módulo dueño del controlador (`InventarioModule` →
 * `inventario`) para el log y Sentry. Corre después de los guards: un 401 o
 * un 403 queda en el log sin módulo.
 */
@Injectable()
export class ModuloDeLaRutaInterceptor implements NestInterceptor {
  private readonly modulos = new Map<unknown, string>();

  constructor(contenedor: ModulesContainer) {
    for (const modulo of contenedor.values()) {
      const nombre = modulo.metatype.name.replace(/Module$/, '').toLowerCase();
      for (const controlador of modulo.controllers.keys()) this.modulos.set(controlador, nombre);
    }
  }

  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const modulo = this.modulos.get(contexto.getClass());
    if (modulo) contexto.switchToHttp().getRequest<PeticionObservada>().modulo = modulo;
    return siguiente.handle();
  }
}
