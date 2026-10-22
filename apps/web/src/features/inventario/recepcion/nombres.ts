import type { TipoDonante } from './datos.ts';
import type { Novedad, Origen } from './enviarRecepcion.ts';

/** Cómo se leen en pantalla los valores que la API guarda como clave. */

export const NOMBRE_DE_TIPO: Record<TipoDonante, string> = {
  empresa: 'Empresa',
  parroquia: 'Parroquia',
  particular: 'Particular',
  otro_banco: 'Otro banco',
};

export const NOMBRE_DE_ORIGEN: Record<Origen, string> = {
  propia: 'Propia',
  abaco: 'ABACO',
  plataforma: 'Plataforma',
};

export const NOMBRE_DE_NOVEDAD: Record<Novedad, string> = {
  roto: 'Roto',
  reempacado: 'Reempacado',
  no_apto: 'No apto',
};
