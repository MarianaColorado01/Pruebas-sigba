/**
 * Contratos compartidos entre la API y la PWA: DTO, enums y eventos.
 *
 * Todo lo que cruza la frontera entre `apps/api` y `apps/web` vive aquí, para
 * que el tipo se defina una sola vez (Arquitectura 5.3). Los esquemas de los
 * ocho eventos de dominio llegan con SBA-30.
 *
 * Un cambio en este paquete es un cambio de contrato: exige revisión del
 * responsable de arquitectura y del equipo consumidor (Arquitectura 5.2).
 */

/** Versión del contrato. Sube con cada cambio incompatible. */
export const VERSION_DE_CONTRATOS = '0.0.0' as const;

/** Módulos funcionales del backend (Arquitectura 5.2). */
export const MODULOS = ['plataforma', 'inventario', 'beneficiarios', 'analitica'] as const;

export type Modulo = (typeof MODULOS)[number];

/**
 * Roles de SIGBA (Arquitectura 8.2). Viven en la base de SIGBA, no en Auth0
 * (ADR-06). `super_admin` es de la red, `institucion` de una institución y el
 * resto de un banco. La PWA los usa para ocultar lo que el rol no puede hacer;
 * la API los exige igual.
 *
 * El orden es precedencia: si un usuario tiene dos roles en el mismo banco, la
 * API actúa con el que va primero. Reordenar la lista cambia ese rol.
 */
export const ROLES = [
  'super_admin',
  'admin_banco',
  'coordinacion',
  'operario_bodega',
  'voluntario',
  'consulta',
  'institucion',
] as const;

export type Rol = (typeof ROLES)[number];

/**
 * Cabeceras con las que la PWA dice en qué banco e institución actúa. La API
 * solo las usa para elegir entre las asignaciones del propio usuario.
 */
export const CABECERAS = {
  banco: 'x-banco-id',
  institucion: 'x-institucion-id',
} as const;

export const CLAVES_PARAMETRO = [
  'aporte_solidario_pct',
  'semaforo_rojo_dias',
  'semaforo_amarillo_dias',
  'rangos_etarios',
  'factor_minorista',
  'recordatorio_borrador_horas',
  'retencion_dias',
] as const;

export type ClaveParametro = (typeof CLAVES_PARAMETRO)[number];

export interface RangoEtario {
  desde: number;
  hasta: number | null;
}

export interface ValorParametro {
  aporte_solidario_pct: number;
  semaforo_rojo_dias: number;
  semaforo_amarillo_dias: number;
  rangos_etarios: RangoEtario[];
  factor_minorista: number;
  recordatorio_borrador_horas: number;
  retencion_dias: number;
}

export interface ParametroVigente<K extends ClaveParametro> {
  valor: ValorParametro[K];
  version: number;
  fecha_inicio: string;
  fecha_fin: string | null;
}

export type ParametroListado = {
  [K in ClaveParametro]: { clave: K } & ParametroVigente<K>;
}[ClaveParametro];

export type ParametroHistorial = ParametroListado;
