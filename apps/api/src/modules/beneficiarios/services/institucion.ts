/**
 * Institución del Banco y el puerto por el que se guarda (SBA-26).
 *
 * El puerto vive aquí y el adaptador de Prisma en `repositories/`: `services/`
 * no importa el SDK (RNF-03). El banco y el actor no viajan por aquí; los pone
 * el adaptador desde el contexto de tenant, igual que RLS.
 */

export const TIPOS_DE_INSTITUCION = ['parroquia', 'comunidad_religiosa', 'fundacion'] as const;

export type TipoDeInstitucion = (typeof TIPOS_DE_INSTITUCION)[number];

export const DIAS_DE_RECOGIDA = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
] as const;

export type DiaDeRecogida = (typeof DIAS_DE_RECOGIDA)[number];

export interface Institucion {
  id: string;
  nombre: string;
  tipo: TipoDeInstitucion;
  contactoNombre: string;
  contactoTelefono: string | null;
  contactoCorreo: string | null;
  direccion: string | null;
  diaRecogida: DiaDeRecogida | null;
  tipoPoblacionId: string;
  activa: boolean;
  actualizadoPor: string | null;
  actualizadoEn: Date | null;
}

/** Lo que el adaptador recibe para un alta, ya limpio. */
export type DatosDeInstitucion = Omit<
  Institucion,
  'id' | 'activa' | 'actualizadoPor' | 'actualizadoEn'
>;

export type CambiosEnInstitucion = Partial<
  Omit<Institucion, 'id' | 'actualizadoPor' | 'actualizadoEn'>
>;

/** Catálogo por banco con el que se clasifica a quién atiende cada institución. */
export interface TipoDePoblacion {
  id: string;
  nombre: string;
  activo: boolean;
}

export interface BusquedaDeInstituciones {
  texto?: string;
  tipo?: TipoDeInstitucion;
  soloActivas: boolean;
}

/** Ya existe otra institución con ese nombre en el banco, sin importar mayúsculas. */
export class NombreDeInstitucionRepetido extends Error {}

/** El tipo de población no existe en el banco del contexto. */
export class TipoDePoblacionInexistente extends Error {}

export abstract class InstitucionesRepositorio {
  /** @throws NombreDeInstitucionRepetido @throws TipoDePoblacionInexistente */
  abstract crear(datos: DatosDeInstitucion): Promise<Institucion>;

  abstract buscar(busqueda: BusquedaDeInstituciones): Promise<Institucion[]>;

  /** Todos los del banco, activos e inactivos, en orden alfabético. */
  abstract tiposDePoblacion(): Promise<TipoDePoblacion[]>;

  /**
   * Devuelve `null` si la institución no existe en el banco del contexto.
   * Registra quién y cuándo hizo el cambio.
   *
   * @throws NombreDeInstitucionRepetido @throws TipoDePoblacionInexistente
   */
  abstract actualizar(id: string, cambios: CambiosEnInstitucion): Promise<Institucion | null>;
}
