import { describe, expect, it } from 'vitest';
import { ConflictoDeVigencia, type ParametroVersion } from './parametros.repositorio.js';
import { decidirEscritura } from './parametros.vigencia.js';

const HOY = '2026-07-10';

function version(fechaInicio: string, valor: unknown, numero = 1): ParametroVersion {
  return {
    id: `v${numero}`,
    clave: 'aporte_solidario_pct',
    valor: valor as never,
    version: numero,
    fechaInicio,
    fechaFin: null,
  };
}

describe('decidirEscritura', () => {
  it('crea cuando no hay historial y la fecha es hoy o futura', () => {
    const vacio = { conEsaFecha: null, ultima: null };
    expect(decidirEscritura(8, HOY, HOY, vacio)).toBe('crear');
    expect(decidirEscritura(8, '2026-07-20', HOY, vacio)).toBe('crear');
  });

  it('devuelve la versión con el mismo valor y la misma fecha, sea futura, de hoy o pasada', () => {
    for (const inicio of ['2026-07-01', HOY, '2026-07-20']) {
      const existente = version(inicio, 8);
      expect(decidirEscritura(8, inicio, HOY, { conEsaFecha: existente, ultima: existente })).toBe(
        'devolver',
      );
    }
  });

  it('compara valores estructurados sin importar el orden de las llaves', () => {
    const existente = version('2026-07-20', [{ desde: 0, hasta: null }]);
    expect(
      decidirEscritura([{ hasta: null, desde: 0 }], '2026-07-20', HOY, {
        conEsaFecha: existente,
        ultima: existente,
      }),
    ).toBe('devolver');
  });

  it('corrige otro valor solo cuando la vigencia empieza después de hoy', () => {
    const futura = version('2026-07-11', 8);
    expect(decidirEscritura(9, '2026-07-11', HOY, { conEsaFecha: futura, ultima: futura })).toBe(
      'corregir',
    );
  });

  it('corrige una versión futura que no es la última', () => {
    const primera = version('2026-07-11', 8, 1);
    const ultima = version('2026-07-20', 9, 2);
    expect(decidirEscritura(7, '2026-07-11', HOY, { conEsaFecha: primera, ultima })).toBe(
      'corregir',
    );
  });

  it('responde 409 para otro valor en una vigencia que empezó hoy o antes', () => {
    for (const inicio of ['2026-07-01', HOY]) {
      const existente = version(inicio, 8);
      expect(() =>
        decidirEscritura(9, inicio, HOY, { conEsaFecha: existente, ultima: existente }),
      ).toThrow(ConflictoDeVigencia);
    }
  });

  it('responde 409 para una fecha nueva anterior a hoy o a la última versión', () => {
    const ultima = version('2026-07-20', 8);
    expect(() =>
      decidirEscritura(9, '2026-07-09', HOY, { conEsaFecha: null, ultima: null }),
    ).toThrow(ConflictoDeVigencia);
    expect(() => decidirEscritura(9, '2026-07-15', HOY, { conEsaFecha: null, ultima })).toThrow(
      ConflictoDeVigencia,
    );
  });
});
