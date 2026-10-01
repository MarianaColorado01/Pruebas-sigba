import { describe, expect, it } from 'vitest';
import { motivoDeCodigoInvalido, normalizarCodigo } from './categoria.js';

describe('normalizarCodigo', () => {
  it('quita los espacios de los lados y pasa a mayúsculas', () => {
    expect(normalizarCodigo(' c801 ')).toBe('C801');
  });

  it('toma una celda vacía o en blanco como sin código', () => {
    expect(normalizarCodigo('   ')).toBeNull();
    expect(normalizarCodigo(undefined)).toBeNull();
  });
});

describe('motivoDeCodigoInvalido', () => {
  const motivo = 'El código del Banco va sin espacios y no puede pasar de 20 caracteres.';

  it('acepta los códigos de la hoja del Banco', () => {
    expect(motivoDeCodigoInvalido('C801')).toBeNull();
    expect(motivoDeCodigoInvalido('APM1401')).toBeNull();
  });

  it('rechaza un código con espacios en medio', () => {
    expect(motivoDeCodigoInvalido('C 801')).toBe(motivo);
    expect(motivoDeCodigoInvalido('C\t801')).toBe(motivo);
  });

  it('rechaza un código más largo que la columna', () => {
    expect(motivoDeCodigoInvalido('C'.repeat(20))).toBeNull();
    expect(motivoDeCodigoInvalido('C'.repeat(21))).toBe(motivo);
  });
});
