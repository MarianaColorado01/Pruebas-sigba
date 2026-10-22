import { describe, expect, it } from 'vitest';
import {
  leerNumero,
  leerRangos,
  rangosEnEdicion,
  valorLegible,
  vigenciaLegible,
} from './parametros.ts';

describe('parametros', () => {
  it('muestra cada valor con su unidad', () => {
    expect(valorLegible({ clave: 'aporte_solidario_pct', valor: 8.5 })).toBe('8,5 %');
    expect(valorLegible({ clave: 'semaforo_rojo_dias', valor: 15 })).toBe('15 días');
    expect(valorLegible({ clave: 'factor_minorista', valor: 1.2 })).toBe('1,2');
    expect(
      valorLegible({
        clave: 'rangos_etarios',
        valor: [
          { desde: 0, hasta: 5 },
          { desde: 60, hasta: null },
        ],
      }),
    ).toBe('0 a 5, 60 o más años');
  });

  it('dice si una versión ya pasó, rige hoy o está programada', () => {
    const hoy = '2026-10-21';
    expect(vigenciaLegible({ fecha_inicio: '2026-11-01', fecha_fin: null }, hoy)).toBe(
      'Programada desde el 1 nov 2026',
    );
    expect(vigenciaLegible({ fecha_inicio: '2026-10-01', fecha_fin: null }, hoy)).toBe(
      'Vigente desde el 1 oct 2026',
    );
    expect(vigenciaLegible({ fecha_inicio: '2026-10-01', fecha_fin: '2026-10-31' }, hoy)).toBe(
      'Vigente del 1 oct 2026 al 31 oct 2026',
    );
    expect(vigenciaLegible({ fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30' }, hoy)).toBe(
      'Del 1 sept 2026 al 30 sept 2026',
    );
  });

  it('lee números con coma o punto', () => {
    expect(leerNumero(' 8,5 ')).toBe(8.5);
    expect(leerNumero('1.2')).toBe(1.2);
    expect(leerNumero('')).toBeNull();
    expect(leerNumero('ocho')).toBeNull();
  });

  it('convierte los rangos del formulario, con «hasta» vacío como sin tope', () => {
    const rangos = [
      { desde: 0, hasta: 17 },
      { desde: 18, hasta: null },
    ];
    expect(leerRangos(rangosEnEdicion(rangos))).toEqual(rangos);
    expect(leerRangos([{ desde: '2,5', hasta: '' }])).toBeNull();
  });
});
