import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { InstitucionesService } from './instituciones.service.js';

/**
 * Qué pide `InstitucionesService` al `tx` del llamador (SBA-33). El aislamiento
 * por banco lo prueba `instituciones-service.integracion.spec.ts` contra
 * PostgreSQL.
 */

const COLUMNAS = { id: true, nombre: true, tipo: true, activa: true };

function txFalso() {
  const institucion = {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
  return { institucion, tx: { institucion } as unknown as Prisma.TransactionClient };
}

describe('InstitucionesService', () => {
  const servicio = new InstitucionesService();

  it('obtener consulta por id en el tx del llamador, sin filtrar inactivas', async () => {
    const { institucion, tx } = txFalso();

    await servicio.obtener(tx, 'id-1');

    expect(institucion.findFirst).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      select: COLUMNAS,
    });
  });

  it('listarActivas pide solo activas, por nombre', async () => {
    const { institucion, tx } = txFalso();

    await servicio.listarActivas(tx);

    expect(institucion.findMany).toHaveBeenCalledWith({
      where: { activa: true },
      orderBy: { nombre: 'asc' },
      select: COLUMNAS,
    });
  });
});
