import type { AsignacionDeUsuario } from '@sigba/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bancoRecordado, opcionesDe, opcionInicial, recordarBanco } from './eleccionDeBanco.ts';

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bancoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const en = (
  rol: AsignacionDeUsuario['rol'],
  bancoId: string | null,
  institucionId: string | null = null,
): AsignacionDeUsuario => ({
  rol,
  bancoId,
  bancoNombre: bancoId ? `Banco ${bancoId.slice(0, 1)}` : null,
  institucionId,
});

describe('opcionesDe', () => {
  it('con dos roles en un banco deja el de más precedencia', () => {
    const opciones = opcionesDe([en('consulta', bancoA), en('admin_banco', bancoA)]);

    expect(opciones).toEqual([en('admin_banco', bancoA)]);
  });

  it('deja aparte la institución y la red', () => {
    const opciones = opcionesDe([
      en('super_admin', null),
      en('coordinacion', bancoA),
      en('institucion', bancoA, instX),
    ]);

    expect(opciones.map((o) => o.rol)).toEqual(['super_admin', 'coordinacion', 'institucion']);
  });
});

describe('opcionInicial', () => {
  const dos = [en('admin_banco', bancoA), en('consulta', bancoB)];

  it('con una sola opción la usa sin preguntar', () => {
    expect(opcionInicial([en('consulta', bancoB)], null)).toEqual(en('consulta', bancoB));
  });

  it('con varias usa el banco recordado', () => {
    expect(opcionInicial(dos, bancoB)).toEqual(en('consulta', bancoB));
  });

  it('con varias y sin banco recordado, o con uno que ya no tiene, pregunta', () => {
    expect(opcionInicial(dos, null)).toBeNull();
    expect(opcionInicial(dos, 'banco-que-ya-no-es-suyo')).toBeNull();
  });

  it('sin opciones no hay con qué arrancar', () => {
    expect(opcionInicial([], bancoA)).toBeNull();
  });
});

describe('banco recordado', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('guarda solo el id del banco', () => {
    recordarBanco(bancoA);

    expect(bancoRecordado()).toBe(bancoA);
    expect({ ...localStorage }).toEqual({ 'sigba.bancoId': bancoA });
  });

  it('elegir la red borra el banco recordado', () => {
    recordarBanco(bancoA);
    recordarBanco(null);

    expect(bancoRecordado()).toBeNull();
  });

  it('sin almacenamiento disponible no rompe', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });

    expect(() => recordarBanco(bancoA)).not.toThrow();
    expect(bancoRecordado()).toBeNull();
  });
});
