import { describe, expect, it } from 'vitest';
import { depurar } from './depurar.js';

describe('depurar', () => {
  it('quita correos, tokens y credenciales en URL', () => {
    const texto = depurar(
      'persona.sintetica+1@example.invalid Bearer abc.def eyJhbGciOi.eyJzdWIiOi.firma postgresql://sigba_app:clave@host/db',
    );

    expect(texto).toBe('[correo] Bearer [depurado] [token] [url con credenciales]@host/db');
  });

  it('quita documentos y teléfonos con o sin separadores', () => {
    expect(depurar('documento 1088234567, cédula 1.088.234.567, tel 300 123 4567')).toBe(
      'documento [número], cédula [número], tel [número]',
    );
  });

  it('quita números con comas de miles y no une líneas distintas', () => {
    expect(depurar('documento 1,088,234,567')).toBe('documento [número]');
    expect(depurar('lote 12\n345')).toBe('lote 12\n345');
  });

  it('conserva UUID, números cortos y el resto del texto', () => {
    const uuid = '0b9f8c1e-1234-4abc-9def-123456789012';

    expect(depurar(`banco ${uuid}: 3 lotes en la bodega 12`)).toBe(
      `banco ${uuid}: 3 lotes en la bodega 12`,
    );
  });
});
