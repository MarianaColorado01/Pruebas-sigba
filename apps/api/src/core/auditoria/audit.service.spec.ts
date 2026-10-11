import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('pasa la entrada a core.registrar_auditoria en la transacción recibida', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await servicio.registrar(tx as never, {
      accion: 'crear',
      entidad: 'categoria',
      entidadId: '33333333-3333-3333-3333-333333333333',
      detalle: { camposModificados: ['nombre'], version: 2, cantidad: 1 },
    });

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['crear', 'categoria', '33333333-3333-3333-3333-333333333333']),
    );
  });

  it('rechaza una clave de detalle desconocida antes de llamar la función', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };

    await expect(
      servicio.registrar(tx as never, {
        accion: 'actualizar',
        entidad: 'categoria',
        entidadId: '33333333-3333-3333-3333-333333333333',
        detalle: { nombre: 'Ana' } as never,
      }),
    ).rejects.toThrow(/clave/i);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rechaza texto libre en cada clave de detalle', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };
    const valores = [{ camposModificados: ['Ana'] }, { version: 'Ana' }, { cantidad: 'Ana' }];

    for (const detalle of valores) {
      await expect(
        servicio.registrar(tx as never, {
          accion: 'actualizar',
          entidad: 'categoria',
          entidadId: '33333333-3333-3333-3333-333333333333',
          detalle: detalle as never,
        }),
      ).rejects.toThrow(/debe ser un entero|detalle|camposModificados/i);
    }

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
