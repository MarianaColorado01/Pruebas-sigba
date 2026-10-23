import { describe, expect, it } from 'vitest';
import {
  MENSAJE_DE_CANTIDAD,
  MENSAJE_DE_CERO,
  MENSAJE_DE_CIFRAS,
  interpretarCantidad,
} from './cantidad.ts';

describe('interpretarCantidad', () => {
  it('lee dígitos y los manda tal cual', () => {
    expect(interpretarCantidad('4200')).toEqual({ valor: '4200', error: null });
    expect(interpretarCantidad('  12 ')).toEqual({ valor: '12', error: null });
  });

  it('lee la coma como separador decimal y la manda con punto', () => {
    expect(interpretarCantidad('4,5')).toEqual({ valor: '4.5', error: null });
    expect(interpretarCantidad('0,125')).toEqual({ valor: '0.125', error: null });
  });

  it('rechaza el punto: «4.200» en Colombia es 4200, no 4,2', () => {
    expect(interpretarCantidad('4.200')).toEqual({ valor: null, error: MENSAJE_DE_CANTIDAD });
    expect(interpretarCantidad('4.5')).toEqual({ valor: null, error: MENSAJE_DE_CANTIDAD });
    expect(interpretarCantidad('1.234,5')).toEqual({ valor: null, error: MENSAJE_DE_CANTIDAD });
  });

  it('rechaza lo que no es dígitos con una coma decimal', () => {
    for (const texto of ['4,5,6', ',5', '4,', ',', '-3', '1e3', '12 kg', '4 200']) {
      expect(interpretarCantidad(texto)).toEqual({ valor: null, error: MENSAJE_DE_CANTIDAD });
    }
  });

  it('admite lo mismo que la API: hasta siete enteros y tres decimales', () => {
    expect(interpretarCantidad('9999999,999')).toEqual({ valor: '9999999.999', error: null });
    for (const texto of ['12345678', '0,3333', '1,2345']) {
      expect(interpretarCantidad(texto)).toEqual({ valor: null, error: MENSAJE_DE_CIFRAS });
    }
  });

  it('quita los ceros sobrantes, como la API: lo equivalente se manda igual', () => {
    for (const texto of ['12,5', '12,50', '012,500', '0012,5']) {
      expect(interpretarCantidad(texto)).toEqual({ valor: '12.5', error: null });
    }
    expect(interpretarCantidad('0,50')).toEqual({ valor: '0.5', error: null });
    expect(interpretarCantidad('7,000')).toEqual({ valor: '7', error: null });
    // Los ceros sobrantes no cuentan para el límite de cifras.
    expect(interpretarCantidad('00001234567,1000')).toEqual({ valor: '1234567.1', error: null });
  });

  it('rechaza el cero, escrito como sea', () => {
    for (const texto of ['0', '000', '0,0', '0,000']) {
      expect(interpretarCantidad(texto)).toEqual({ valor: null, error: MENSAJE_DE_CERO });
    }
  });

  it('un campo vacío no es un error: falta escribirlo', () => {
    expect(interpretarCantidad('')).toEqual({ valor: null, error: null });
    expect(interpretarCantidad('   ')).toEqual({ valor: null, error: null });
  });

  it('el mensaje dice cómo escribirla', () => {
    expect(MENSAJE_DE_CANTIDAD).toBe(
      'Escribe la cantidad sin puntos; usa coma para los decimales (4200 o 4,5).',
    );
  });
});
