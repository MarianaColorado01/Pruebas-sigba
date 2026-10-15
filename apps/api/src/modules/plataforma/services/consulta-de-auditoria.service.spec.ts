import { BadRequestException } from '@nestjs/common';
import type { RegistroDeAuditoria } from '@sigba/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { AuditoriaRepositorio, ExportacionDemasiadoGrande } from './auditoria.js';
import { ConsultaDeAuditoriaService } from './consulta-de-auditoria.service.js';

function registro(cambios: Partial<RegistroDeAuditoria> = {}): RegistroDeAuditoria {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ocurridoEn: '2026-10-14T15:30:00.123456Z',
    tipoActor: 'usuario',
    actorId: '22222222-2222-4222-8222-222222222222',
    actorNombre: 'Coordinadora',
    actorEtiqueta: null,
    accion: 'crear',
    entidad: 'institucion',
    entidadId: '33333333-3333-4333-8333-333333333333',
    resultado: 'ok',
    finalidad: null,
    detalle: null,
    ...cambios,
  };
}

function preparar() {
  const repositorio = {
    listar: vi.fn<AuditoriaRepositorio['listar']>(),
    exportar: vi.fn<AuditoriaRepositorio['exportar']>(),
  };
  const servicio = new ConsultaDeAuditoriaService(repositorio as unknown as AuditoriaRepositorio);
  return { repositorio, servicio };
}

describe('ConsultaDeAuditoriaService.consultar', () => {
  it('pasa el filtro al repositorio con 50 registros por página', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.listar.mockResolvedValue({ registros: [registro()], hayMas: false });
    const filtro = {
      actor: 'sistema:retencion',
      tipoActor: 'sistema' as const,
      accion: 'leer' as const,
    };

    const pagina = await servicio.consultar(filtro);

    expect(repositorio.listar).toHaveBeenCalledWith(filtro, undefined, 50);
    expect(pagina).toEqual({ registros: [registro()], siguienteCursor: null });
  });

  it('respeta el límite pedido', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.listar.mockResolvedValue({ registros: [], hayMas: false });

    await servicio.consultar({ limite: 10 });

    expect(repositorio.listar).toHaveBeenCalledWith({}, undefined, 10);
  });

  it('el cursor de una página lleva a la siguiente justo después del último registro', async () => {
    const { repositorio, servicio } = preparar();
    const ultimo = registro({ id: '44444444-4444-4444-8444-444444444444' });
    repositorio.listar.mockResolvedValueOnce({ registros: [registro(), ultimo], hayMas: true });
    repositorio.listar.mockResolvedValueOnce({ registros: [], hayMas: false });

    const primera = await servicio.consultar({ entidad: 'institucion' });
    expect(primera.siguienteCursor).toEqual(expect.any(String));

    await servicio.consultar({ entidad: 'institucion', cursor: primera.siguienteCursor ?? '' });

    expect(repositorio.listar).toHaveBeenLastCalledWith(
      { entidad: 'institucion' },
      { ocurridoEn: ultimo.ocurridoEn, id: ultimo.id },
      50,
    );
  });

  it.each([
    ['basura', 'no-es-un-cursor'],
    ['otra forma', Buffer.from('2026-10-14|42').toString('base64url')],
  ])('rechaza un cursor %s con 400', async (_caso, cursor) => {
    const { repositorio, servicio } = preparar();

    await expect(servicio.consultar({ cursor })).rejects.toThrow(BadRequestException);
    expect(repositorio.listar).not.toHaveBeenCalled();
  });

  it('rechaza un rango que termina antes de empezar', async () => {
    const { repositorio, servicio } = preparar();

    await expect(
      servicio.consultar({ desde: new Date('2026-10-15'), hasta: new Date('2026-10-01') }),
    ).rejects.toThrow(BadRequestException);
    expect(repositorio.listar).not.toHaveBeenCalled();
  });
});

describe('ConsultaDeAuditoriaService.exportarCsv', () => {
  const desde = new Date('2026-10-01T05:00:00Z');
  const hasta = new Date('2026-11-01T05:00:00Z');

  it('pide el periodo al repositorio y arma un CSV con encabezado, una fila por registro', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.exportar.mockResolvedValue([
      registro(),
      registro({
        tipoActor: 'sistema',
        actorId: null,
        actorNombre: null,
        actorEtiqueta: 'sistema:retencion',
        accion: 'leer',
        entidad: 'beneficiario',
        entidadId: 'beneficiarios_de_institucion:33333333-3333-4333-8333-333333333333',
        finalidad: 'entrega_de_mercado',
        detalle: { cantidad: 12 },
      }),
    ]);

    const csv = await servicio.exportarCsv(desde, hasta);

    expect(repositorio.exportar).toHaveBeenCalledWith(desde, hasta, 50_000);
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'ocurrido_en,tipo_actor,actor,actor_id,accion,entidad,entidad_id,resultado,finalidad,cantidad',
      '2026-10-14T15:30:00.123456Z,usuario,Coordinadora,22222222-2222-4222-8222-222222222222,crear,institucion,33333333-3333-4333-8333-333333333333,ok,,',
      '2026-10-14T15:30:00.123456Z,sistema,sistema:retencion,,leer,beneficiario,beneficiarios_de_institucion:33333333-3333-4333-8333-333333333333,ok,entrega_de_mercado,12',
      '',
    ]);
  });

  it('entrecomilla comas y comillas y desarma fórmulas de hoja de cálculo', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.exportar.mockResolvedValue([registro({ actorNombre: '=HYPERLINK("x"), "Ana"' })]);

    const csv = await servicio.exportarCsv(desde, hasta);

    expect(csv).toContain(`,"'=HYPERLINK(""x""), ""Ana""",`);
  });

  it('sin nombre de usuario deja el id como actor', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.exportar.mockResolvedValue([registro({ actorNombre: null })]);

    const csv = await servicio.exportarCsv(desde, hasta);

    expect(csv).toContain(
      ',usuario,22222222-2222-4222-8222-222222222222,22222222-2222-4222-8222-222222222222,',
    );
  });

  it('rechaza un periodo vacío o invertido', async () => {
    const { repositorio, servicio } = preparar();

    await expect(servicio.exportarCsv(hasta, desde)).rejects.toThrow(BadRequestException);
    await expect(servicio.exportarCsv(desde, desde)).rejects.toThrow(BadRequestException);
    expect(repositorio.exportar).not.toHaveBeenCalled();
  });

  it('un periodo con demasiados registros responde 400 y pide acortarlo', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.exportar.mockRejectedValue(new ExportacionDemasiadoGrande(50_000));

    await expect(servicio.exportarCsv(desde, hasta)).rejects.toThrow(/acorta/i);
  });

  it('deja pasar cualquier otro error del repositorio', async () => {
    const { repositorio, servicio } = preparar();
    repositorio.exportar.mockRejectedValue(new Error('se cayó la base'));

    await expect(servicio.exportarCsv(desde, hasta)).rejects.toThrow('se cayó la base');
  });
});
