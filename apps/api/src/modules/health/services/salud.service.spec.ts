import { describe, expect, it } from 'vitest';
import { SaludService } from './salud.service.js';

describe('SaludService', () => {
  const momento = new Date('2026-09-17T14:30:00.000Z');

  it('informa que el proceso responde', () => {
    expect(new SaludService().consultar(0, momento).estado).toBe('ok');
  });

  it('sella la respuesta con el momento en ISO 8601', () => {
    expect(new SaludService().consultar(0, momento).momento).toBe('2026-09-17T14:30:00.000Z');
  });

  it('redondea el tiempo en pie a segundos enteros', () => {
    expect(new SaludService().consultar(12.9, momento).tiempoEnPie).toBe(12);
  });
});
