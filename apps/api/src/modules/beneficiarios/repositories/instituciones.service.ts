import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { TipoDeInstitucion } from '../services/institucion.js';

/** Lo que `inventario` necesita para nombrar el destino de una salida. */
export interface InstitucionDestino {
  id: string;
  nombre: string;
  tipo: TipoDeInstitucion;
  activa: boolean;
}

const COLUMNAS = { id: true, nombre: true, tipo: true, activa: true } as const;

/**
 * Lectura de instituciones para `inventario` (SBA-33, ADR-14, RF-M2-16).
 *
 * Cada método recibe el `tx` de la transacción del llamador, ya con el banco
 * fijado por `executeTransactionWithTenant`: la consulta ve lo mismo que la
 * salida que se registra y no abre otra conexión (Arquitectura 8.1, ADR-08).
 * Vive en `repositories/` porque su firma nombra el cliente de Prisma, que
 * `services/` no puede importar.
 */
@Injectable()
export class InstitucionesService {
  /**
   * También devuelve las inactivas, para que el llamador distinga «inactiva»
   * de «no existe». Una de otro banco, por RLS, es `null`.
   */
  obtener(tx: Prisma.TransactionClient, id: string): Promise<InstitucionDestino | null> {
    return tx.institucion.findFirst({ where: { id }, select: COLUMNAS });
  }

  /** Las activas del banco, por nombre, para elegir destinatario. */
  listarActivas(tx: Prisma.TransactionClient): Promise<InstitucionDestino[]> {
    return tx.institucion.findMany({
      where: { activa: true },
      orderBy: { nombre: 'asc' },
      select: COLUMNAS,
    });
  }
}
