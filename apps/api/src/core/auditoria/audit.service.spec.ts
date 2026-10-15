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

describe('AuditService.registrarLectura', () => {
  const conjunto = 'beneficiarios_de_institucion:33333333-3333-3333-3333-333333333333';

  it('registra la acción leer con el conjunto, la finalidad y la cantidad de filas', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };

    await servicio.registrarLectura(tx as never, {
      entidad: 'beneficiario',
      conjunto,
      cantidad: 12,
      finalidad: 'entrega_de_mercado',
    });

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([
        'leer',
        'beneficiario',
        conjunto,
        'entrega_de_mercado',
        JSON.stringify({ cantidad: 12 }),
      ]),
    );
  });

  it.each([
    ['un nombre', 'beneficiarios:Ana Gómez'],
    ['un documento', 'beneficiarios_por_documento:1088123456'],
    ['texto de búsqueda', 'beneficiarios?texto=ana'],
    ['un id que no es UUID', 'beneficiarios_de_institucion:42'],
  ])('rechaza un conjunto con %s', async (_caso, conjuntoInvalido) => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };

    await expect(
      servicio.registrarLectura(tx as never, {
        entidad: 'beneficiario',
        conjunto: conjuntoInvalido,
        cantidad: 1,
        finalidad: 'entrega_de_mercado',
      }),
    ).rejects.toThrow(/conjunto/i);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rechaza entidad o finalidad que no sean códigos', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };
    const base = { entidad: 'beneficiario', conjunto, cantidad: 1, finalidad: 'entrega' };

    await expect(
      servicio.registrarLectura(tx as never, { ...base, entidad: 'Beneficiario Ana' }),
    ).rejects.toThrow(/entidad/i);
    await expect(
      servicio.registrarLectura(tx as never, { ...base, finalidad: 'Llamar a Ana al 310' }),
    ).rejects.toThrow(/finalidad/i);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rechaza una cantidad negativa o fraccionaria', async () => {
    const servicio = new AuditService();
    const tx = { $queryRaw: vi.fn() };
    const base = { entidad: 'beneficiario', conjunto, finalidad: 'entrega' };

    for (const cantidad of [-1, 1.5]) {
      await expect(servicio.registrarLectura(tx as never, { ...base, cantidad })).rejects.toThrow(
        /cantidad/i,
      );
    }
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
