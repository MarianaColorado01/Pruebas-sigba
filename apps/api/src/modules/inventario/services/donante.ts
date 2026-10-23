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

/** Resultado del alta: `repetido` si ya había un donante activo con ese nombre y tipo. */
export interface AltaDeDonante {
  donante: Donante;
  repetido: boolean;
}

/** Otro donante activo del banco ya tiene ese nombre y tipo. */
export class NombreDeDonanteRepetido extends Error {}

export interface BusquedaDeDonantes {
  id?: string;
  texto?: string;
  tipo?: TipoDonante;
  soloActivos: boolean;
  limite: number;
}

export abstract class DonantesRepositorio {
  /**
   * Si ya hay un donante activo con ese nombre y tipo, sin distinguir
   * mayúsculas (la llave del índice único), lo devuelve con `repetido: true`
   * en vez de crear otro. Vale también cuando otra alta igual gana la carrera.
   */
  abstract crear(datos: DatosDeDonante): Promise<AltaDeDonante>;

  abstract buscar(busqueda: BusquedaDeDonantes): Promise<Donante[]>;

  /**
   * Devuelve `null` si el donante no existe en el banco del contexto.
   *
   * @throws NombreDeDonanteRepetido
   */
  abstract actualizar(id: string, cambios: CambiosEnDonante): Promise<Donante | null>;
}
