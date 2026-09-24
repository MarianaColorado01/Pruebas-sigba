/**
 * Donante del Banco y el puerto por el que se guarda (SBA-25).
 *
 * El puerto vive aquí y el adaptador de Prisma en `repositories/`: `services/`
 * no importa el SDK (RNF-03). El banco y el actor no viajan por aquí; los pone
 * el adaptador desde el contexto de tenant, igual que RLS.
 */

export const TIPOS_DE_DONANTE = ['empresa', 'parroquia', 'particular', 'otro_banco'] as const;

export type TipoDonante = (typeof TIPOS_DE_DONANTE)[number];

export interface Donante {
  id: string;
  nombre: string;
  tipo: TipoDonante;
  contacto: string | null;
  activo: boolean;
}

/** Lo que el adaptador recibe para un alta, ya limpio. */
export type DatosDeDonante = Pick<Donante, 'nombre' | 'tipo' | 'contacto'>;

export type CambiosEnDonante = Partial<Omit<Donante, 'id'>>;

export interface BusquedaDeDonantes {
  texto?: string;
  tipo?: TipoDonante;
  soloActivos: boolean;
  limite: number;
}

export abstract class DonantesRepositorio {
  abstract crear(datos: DatosDeDonante): Promise<Donante>;

  abstract buscar(busqueda: BusquedaDeDonantes): Promise<Donante[]>;

  /** Devuelve `null` si el donante no existe en el banco del contexto. */
  abstract actualizar(id: string, cambios: CambiosEnDonante): Promise<Donante | null>;
}
