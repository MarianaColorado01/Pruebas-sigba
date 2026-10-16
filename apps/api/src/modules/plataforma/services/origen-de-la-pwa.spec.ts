import { describe, expect, it } from 'vitest';
import { cargarOrigenDeLaPwa } from './origen-de-la-pwa.js';

describe('cargarOrigenDeLaPwa', () => {
  it.each([
    ['https://sigba.example', 'https://sigba.example'],
    ['  https://sigba.example/  ', 'https://sigba.example'],
    ['http://localhost:5173', 'http://localhost:5173'],
  ])('acepta %j', (valor, esperado) => {
    expect(cargarOrigenDeLaPwa({ WEB_URL: valor })).toBe(esperado);
  });

  it.each([
    ['sin definir', undefined, /Falta .*WEB_URL/],
    ['vacía', '   ', /Falta .*WEB_URL/],
    ['que no es URL', 'sigba.example', /URL válida/],
    ['con otro protocolo', 'ftp://sigba.example', /origen http/],
    ['con ruta', 'https://sigba.example/app', /origen http/],
    ['con consulta', 'https://sigba.example/?a=1', /origen http/],
    ['con credenciales', 'https://ana:clave@sigba.example', /origen http/],
  ])('rechaza una WEB_URL %s con un mensaje claro', (_caso, valor, mensaje) => {
    const entorno = valor === undefined ? {} : { WEB_URL: valor };
    expect(() => cargarOrigenDeLaPwa(entorno)).toThrow(mensaje);
  });
});
