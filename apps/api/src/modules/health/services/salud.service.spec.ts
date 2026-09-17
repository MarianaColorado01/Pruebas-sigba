import { describe, expect, it } from 'vitest';
import { SaludService } from './salud.service.js';

describe('SaludService', () => {
  const reloj = () => new Date('2026-09-17T14:30:00.000Z');

  it('informa que el proceso responde', () => {
    const servicio = new SaludService(reloj);

    expect(servicio.consultar(0).estado).toBe('ok');
  });

  it('sella la respuesta con el momento en ISO 8601', () => {
    const servicio = new SaludService(reloj);

    expect(servicio.consultar(0).momento).toBe('2026-09-17T14:30:00.000Z');
  });

  it('redondea el tiempo en pie a segundos enteros', () => {
    const servicio = new SaludService(reloj);

    expect(servicio.consultar(12.9).tiempoEnPie).toBe(12);
  });
});
