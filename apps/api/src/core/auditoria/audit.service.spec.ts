import { describe, expect, it, vi } from 'vitest';
import { runWithTenantContext } from '../database/tenant-context.js';
import { AuditService, resolverActor } from './audit.service.js';

describe('resolverActor', () => {
  it('resuelve un usuario cuando usuarioId es UUID', () => {
    expect(
      resolverActor({
        bancoId: '11111111-1111-1111-1111-111111111111',
        usuarioId: '22222222-2222-2222-2222-222222222222',
      }),
    ).toEqual({
      actorTipo: 'usuario',
      actorId: '22222222-2222-2222-2222-222222222222',
      actorEtiqueta: null,
    });
  });

  it('resuelve una etiqueta como actor del sistema', () => {
    expect(
      resolverActor({
        bancoId: '11111111-1111-1111-1111-111111111111',
        usuarioId: 'importar-codigos',
      }),
    ).toEqual({
      actorTipo: 'sistema',
      actorId: null,
      actorEtiqueta: 'importar-codigos',
    });
  });
});

describe('AuditService', () => {
  it('registra metadatos de auditoría con el contexto actual', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await runWithTenantContext(
      {
        bancoId: '11111111-1111-1111-1111-111111111111',
        usuarioId: 'importar-codigos',
      },
      () =>
        servicio.registrar(tx as never, {
          accion: 'crear',
          entidad: 'categoria',
          entidadId: '33333333-3333-3333-3333-333333333333',
          detalle: { camposModificados: ['nombre'], version: 2, cantidad: 1 },
        }),
    );

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining(['crear', 'categoria', '33333333-3333-3333-3333-333333333333']),
    );
  });

  it('rechaza una clave de detalle desconocida antes de llamar la función', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };

    await runWithTenantContext(
      { bancoId: '11111111-1111-1111-1111-111111111111', usuarioId: 'importar-codigos' },
      () =>
        expect(
          servicio.registrar(tx as never, {
            accion: 'actualizar',
            entidad: 'categoria',
            entidadId: '33333333-3333-3333-3333-333333333333',
            detalle: { nombre: 'Ana' } as never,
          }),
        ).rejects.toThrow(/clave/i),
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rechaza texto libre en cada clave de detalle', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };
    const valores = [{ camposModificados: ['Ana'] }, { version: 'Ana' }, { cantidad: 'Ana' }];

    await runWithTenantContext(
      { bancoId: '11111111-1111-1111-1111-111111111111', usuarioId: 'importar-codigos' },
      async () => {
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
      },
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('falla si falta el contexto del tenant', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };

    await expect(
      servicio.registrar(tx as never, {
        accion: 'leer',
        entidad: 'beneficiario',
        entidadId: '44444444-4444-4444-4444-444444444444',
      }),
    ).rejects.toThrow(/contexto/);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
