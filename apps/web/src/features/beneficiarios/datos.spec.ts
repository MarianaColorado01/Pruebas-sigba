import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from '@/shared/clienteHttp';
import { edad, esMenor, fechaLocal, mensajeDeError } from './datos.ts';

const hoy = new Date(2026, 9, 21);

describe('edad', () => {
  it('cumple los años el día de su cumpleaños, no antes', () => {
    expect(edad('2008-10-21', hoy)).toBe(18);
    expect(edad('2008-10-22', hoy)).toBe(17);
    expect(edad('2008-11-01', hoy)).toBe(17);
  });
});

describe('fechaLocal', () => {
  it('usa el día del navegador, no el de UTC', () => {
    expect(fechaLocal(new Date(2026, 9, 22, 23, 30))).toBe('2026-10-22');
    expect(fechaLocal(new Date(2026, 0, 5, 0, 10))).toBe('2026-01-05');
  });
});

describe('esMenor', () => {
  it('manda la fecha de nacimiento', () => {
    expect(esMenor('cc', '2010-01-01', hoy)).toBe(true);
    expect(esMenor('ti', '2000-01-01', hoy)).toBe(false);
  });

  it('sin fecha, la tarjeta de identidad y el registro civil anticipan que es menor', () => {
    expect(esMenor('ti', '', hoy)).toBe(true);
    expect(esMenor('registro_civil', '', hoy)).toBe(true);
    expect(esMenor('cc', '', hoy)).toBe(false);
  });
});

describe('mensajeDeError', () => {
  it('nunca muestra el mensaje de la API', () => {
    const conDocumento = new ErrorDeApi(400, 'numeroDocumento 900111222 no es válido');
    expect(mensajeDeError(conDocumento)).not.toContain('900111222');
  });

  it('distingue los conflictos por código', () => {
    expect(mensajeDeError(new ErrorDeApi(409, 'x', 'tipo_distinto'))).toMatch(/otro tipo/);
    expect(mensajeDeError(new ErrorDeApi(409, 'x', 'registro_simultaneo'))).toMatch(/primero/);
    expect(mensajeDeError(new ErrorDeApi(409, 'x'))).toMatch(/conflicto/);
    expect(mensajeDeError(new ErrorDeApi(404, 'x'))).toMatch(/ya no está activo/);
    expect(mensajeDeError(new ErrorDeApi(403, 'x'))).toMatch(/Tu rol/);
    expect(mensajeDeError(new ErrorDeApi(500, 'x'))).toBe(
      'No se pudo guardar. Inténtalo de nuevo.',
    );
  });
});
