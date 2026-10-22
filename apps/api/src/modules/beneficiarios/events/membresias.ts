import type { MembresiaActivadaV1, MembresiaCerradaV1 } from '@sigba/shared-types';
import type { Membresia } from '../services/registro.js';

/**
 * Eventos de membresía, v1 de docs/eventos/contratos.v1.json, con los tipos de
 * `@sigba/shared-types` (SBA-88). La carga lleva solo identificadores: ningún
 * dato de la persona sale en un evento (Arquitectura 8.6).
 */
export type EventoDeMembresia = MembresiaActivadaV1 | MembresiaCerradaV1;

function carga(membresia: Membresia): EventoDeMembresia['payload'] {
  return {
    membresiaId: membresia.id,
    beneficiarioId: membresia.beneficiarioId,
    institucionId: membresia.institucionId,
  };
}

export const membresiaActivada = (membresia: Membresia): MembresiaActivadaV1 => ({
  tipo: 'MembresiaActivada',
  version: 1,
  payload: carga(membresia),
});

export const membresiaCerrada = (membresia: Membresia): MembresiaCerradaV1 => ({
  tipo: 'MembresiaCerrada',
  version: 1,
  payload: carga(membresia),
});
