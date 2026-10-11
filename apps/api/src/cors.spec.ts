import { afterEach, describe, expect, it, vi } from 'vitest';
import { corsOrigins } from './cors.js';

describe('corsOrigins', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('limita el origen por defecto a la PWA local', () => {
    vi.stubEnv('CORS_ORIGINS', '');
    delete process.env['CORS_ORIGINS'];

    expect(corsOrigins()).toEqual(['http://localhost:5173']);
  });

  it('lee orígenes exactos, quita espacios y elimina duplicados', () => {
    expect(
      corsOrigins(' http://localhost:5173, https://sigba.pages.dev,http://localhost:5173 '),
    ).toEqual(['http://localhost:5173', 'https://sigba.pages.dev']);
  });

  it.each(['', '*', 'http://localhost:5173/app', 'file://localhost'])('rechaza %s', (value) => {
    expect(() => corsOrigins(value)).toThrow();
  });
});
