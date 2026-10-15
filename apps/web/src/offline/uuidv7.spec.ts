import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuidv7.ts';

describe('uuidv7', () => {
  it('tiene la forma de un UUID versión 7, variante RFC', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('empieza por el instante en milisegundos, así que ordena por tiempo', () => {
    const id = uuidv7(0x0192_0000_0001);

    expect(id.startsWith('01920000-0001-7')).toBe(true);
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });

  it('no repite en llamadas seguidas', () => {
    expect(new Set(Array.from({ length: 100 }, () => uuidv7(5))).size).toBe(100);
  });
});
