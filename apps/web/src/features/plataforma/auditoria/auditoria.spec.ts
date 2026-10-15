import type { RegistroDeAuditoria } from '@sigba/shared-types';
import { describe, expect, it } from 'vitest';
import {
  agruparPorDia,
  consultaParaApi,
  filtrosDeUrl,
  nombreDeActor,
  queHizo,
  rangoParaApi,
  tituloDelDia,
} from './auditoria.ts';

function registro(cambios: Partial<RegistroDeAuditoria> = {}): RegistroDeAuditoria {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ocurridoEn: new Date(2026, 9, 14, 15, 30).toISOString(),
    tipoActor: 'usuario',
    actorId: '22222222-2222-4222-8222-222222222222',
    actorNombre: 'Marta Coordinadora',
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

describe('rango de fechas', () => {
  it('convierte días locales incluidos en el periodo [desde, hasta) de la API', () => {
    expect(rangoParaApi('2026-10-01', '2026-10-31')).toEqual({
      desde: new Date(2026, 9, 1).toISOString(),
      hasta: new Date(2026, 10, 1).toISOString(),
    });
  });

  it('arma la consulta con filtros, rango y cursor, sin parámetros vacíos', () => {
    const ruta = consultaParaApi({ accion: 'leer', desde: '2026-10-01', entidad: '' }, 'abc');
    const parametros = new URLSearchParams(ruta.split('?')[1]);

    expect(ruta.startsWith('/auditoria?')).toBe(true);
    expect(Object.fromEntries(parametros)).toEqual({
      accion: 'leer',
      desde: new Date(2026, 9, 1).toISOString(),
      cursor: 'abc',
    });
    expect(consultaParaApi({})).toBe('/auditoria');
  });

  it('lee de la URL solo los filtros conocidos', () => {
    const filtros = filtrosDeUrl(new URLSearchParams('accion=leer&otro=x&tipoActor=sistema'));

    expect(filtros).toEqual({ accion: 'leer', tipoActor: 'sistema' });
  });
});

describe('frases de la línea de tiempo', () => {
  it('una lectura dice cuántos registros y de qué, nunca su contenido', () => {
    const lectura = registro({
      accion: 'leer',
      entidad: 'beneficiario',
      detalle: { cantidad: 12 },
    });

    expect(queHizo(lectura)).toBe('consultó 12 registros de beneficiario');
    expect(queHizo({ ...lectura, detalle: { cantidad: 1 } })).toBe(
      'consultó 1 registro de beneficiario',
    );
  });

  it('una escritura dice el verbo y la entidad', () => {
    expect(queHizo(registro({ accion: 'actualizar', entidad: 'parametro_banco' }))).toBe(
      'actualizó parametro banco',
    );
  });

  it('distingue a una persona de una tarea del sistema', () => {
    expect(nombreDeActor(registro())).toBe('Marta Coordinadora');
    expect(
      nombreDeActor(
        registro({
          tipoActor: 'sistema',
          actorId: null,
          actorNombre: null,
          actorEtiqueta: 'sistema:retencion_de_datos',
        }),
      ),
    ).toBe('Sistema · retencion de datos');
    expect(nombreDeActor(registro({ actorNombre: null }))).toBe('Usuario 22222222');
  });
});

describe('agrupación por día', () => {
  it('agrupa por día local respetando el orden de llegada', () => {
    const tarde = registro({ id: 'a', ocurridoEn: new Date(2026, 9, 14, 18).toISOString() });
    const manana = registro({ id: 'b', ocurridoEn: new Date(2026, 9, 14, 7).toISOString() });
    const ayer = registro({ id: 'c', ocurridoEn: new Date(2026, 9, 13, 23).toISOString() });

    const grupos = agruparPorDia([tarde, manana, ayer]);

    expect(grupos.map((g) => [g.dia, g.registros.map((r) => r.id)])).toEqual([
      ['2026-10-14', ['a', 'b']],
      ['2026-10-13', ['c']],
    ]);
  });

  it('nombra hoy, ayer y los demás días por su fecha', () => {
    const hoy = new Date(2026, 9, 15, 10);

    expect(tituloDelDia('2026-10-15', hoy)).toBe('Hoy');
    expect(tituloDelDia('2026-10-14', hoy)).toBe('Ayer');
    expect(tituloDelDia('2026-10-12', hoy)).toMatch(/^Lunes.*12.*octubre/);
  });
});
