/**
 * Contratos compartidos entre la API y la PWA: DTO, enums y eventos.
 *
 * Todo lo que cruza la frontera entre `apps/api` y `apps/web` vive aquí, para
 * que el tipo se defina una sola vez (Arquitectura 5.3). Los contratos de
 * evento de SBA-30 siguen en borrador hasta recibir aprobación.
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

/**
 * Acciones que registra `core.auditoria` (RNF-04). `leer` es una consulta de
 * datos personales: guarda qué conjunto y cuántas filas, nunca su contenido
 * (Arquitectura 8.6).
 */
export const ACCIONES_DE_AUDITORIA = ['crear', 'actualizar', 'eliminar', 'leer'] as const;

export type AccionDeAuditoria = (typeof ACCIONES_DE_AUDITORIA)[number];

/** Quién actuó: una persona con sesión o una tarea del sistema. */
export const TIPOS_DE_ACTOR = ['usuario', 'sistema'] as const;

export type TipoDeActor = (typeof TIPOS_DE_ACTOR)[number];

/** Un registro de `GET /api/v1/auditoria` (SBA-51). */
export interface RegistroDeAuditoria {
  id: string;
  /** Instante ISO 8601. */
  ocurridoEn: string;
  tipoActor: TipoDeActor;
  /** Usuario de SIGBA; `null` si actuó el sistema. */
  actorId: string | null;
  /** `null` si actuó el sistema o la persona ya no tiene asignación en el banco. */
  actorNombre: string | null;
  /** Tarea del sistema, por ejemplo `sistema:retencion`; `null` si actuó un usuario. */
  actorEtiqueta: string | null;
  accion: AccionDeAuditoria;
  entidad: string;
  /** Id de la fila, o el conjunto leído en una lectura. */
  entidadId: string;
  resultado: string;
  finalidad: string | null;
  detalle: { camposModificados?: string[]; version?: number; cantidad?: number } | null;
}

export interface PaginaDeAuditoria {
  registros: RegistroDeAuditoria[];
  /** Se manda como `cursor` para pedir los registros anteriores; `null` al final. */
  siguienteCursor: string | null;
}
