import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { concatMap, type Observable, from, map, of } from 'rxjs';
import { executeTransactionWithTenant } from '../database/prisma-rls.extension.js';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService } from './audit.service.js';

export const AUDITAR_LECTURA = 'sigba:auditar-lectura';

interface ConfiguracionDeLectura {
  entidad: string;
  finalidad?: string;
}

export function AuditarLectura(entidad: string, finalidad?: string): MethodDecorator {
  return SetMetadata(AUDITAR_LECTURA, { entidad, finalidad } satisfies ConfiguracionDeLectura);
}

interface RespuestaConId {
  id?: unknown;
}

interface PeticionConParametros {
  params?: { id?: unknown };
}

function idsConsultados(respuesta: unknown, peticion: PeticionConParametros): string[] {
  const ids = new Set<string>();
  if (typeof peticion.params?.id === 'string') ids.add(peticion.params.id);

  const filas = Array.isArray(respuesta) ? respuesta : [respuesta];
  for (const fila of filas) {
    if (fila && typeof fila === 'object' && 'id' in fila) {
      const id = (fila as RespuestaConId).id;
      if (typeof id === 'string') ids.add(id);
    }
  }
  return [...ids];
}

@Injectable()
export class AuditoriaInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {}

  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const configuracion = this.reflector.getAllAndOverride<ConfiguracionDeLectura | undefined>(
      AUDITAR_LECTURA,
      [contexto.getHandler(), contexto.getClass()],
    );
    if (!configuracion) return siguiente.handle();

    const peticion = contexto.switchToHttp().getRequest<PeticionConParametros>();
    return siguiente.handle().pipe(
      concatMap((respuesta) => {
        const ids = idsConsultados(respuesta, peticion);
        if (ids.length === 0) return of(respuesta);

        // TODO: usar la transacción de la petición cuando core la exponga; hoy esta transacción corre después del handler.
        return from(
          executeTransactionWithTenant(this.prisma, async (tx) => {
            for (const entidadId of ids) {
              await this.auditoria.registrar(tx, {
                accion: 'leer',
                entidad: configuracion.entidad,
                entidadId,
                finalidad: configuracion.finalidad,
              });
            }
          }),
        ).pipe(map(() => respuesta));
      }),
    );
  }
}
