import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { runWithTenantContext } from '../database/tenant-context.js';
import type { PeticionAutorizada } from './roles.guard.js';

/**
 * Corre el controlador dentro del contexto que resolvió `RolesGuard`, para que
 * `$transactionWithTenant` lo encuentre sin que nadie lo pase a mano.
 *
 * Hace falta un interceptor porque un guard no envuelve al controlador:
 * `AsyncLocalStorage` fijado dentro del guard no llega a lo que corre después.
 */
@Injectable()
export class ContextoDeTenantInterceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const tenant = contexto.switchToHttp().getRequest<PeticionAutorizada>().contextoTenant ?? {};

    return new Observable((suscriptor) =>
      runWithTenantContext(tenant, () => siguiente.handle().subscribe(suscriptor)),
    );
  }
}
