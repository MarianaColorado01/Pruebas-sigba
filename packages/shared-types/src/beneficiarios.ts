/**
 * Registro nominal de beneficiarios (SBA-27, SBA-28). Esquema en
 * docs/SBA-15/esquema_beneficiarios.md, secciones 6 y 7.
 *
 * Solo datos sintéticos hasta que cierren SBA-16 y SBA-65. Los campos de la
 * persona son los del esquema v5.0 y siguen abiertos con Cáritas (SBA-16):
 * pueden cambiar antes del primer dato real. Ningún campo de estos va a logs,
 * a eventos ni a IndexedDB sin cifrar (Arquitectura 8.6).
 */

/** `pep` sigue mientras el Banco no diga si aún lo recibe (D45, abierto). */
export const TIPOS_DE_DOCUMENTO = [
  'cc',
  'ce',
  'ti',
  'pasaporte',
  'registro_civil',
  'pep',
  'ppt',
] as const;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

export const SEXOS = ['masculino', 'femenino', 'prefiero_no_decirlo'] as const;

export type Sexo = (typeof SEXOS)[number];

export const PARENTESCOS = [
  'madre',
  'padre',
  'padrastro_madrastra',
  'abuelo_a',
  'bisabuelo_a',
  'hermano_a',
  'hermanastro_a',
  'tio_a',
  'tio_abuelo_a',
  'primo_a',
  'cunado_a',
  'sobrino_a',
  'tutor_legal',
  'otro',
] as const;

export type Parentesco = (typeof PARENTESCOS)[number];

/** `traslado` solo lo asigna el traslado de coordinación, no el cierre. */
export const MOTIVOS_DE_CIERRE_DE_MEMBRESIA = [
  'se_mudo',
  'dejo_de_asistir',
  'fallecio',
  'otro',
] as const;

export type MotivoDeCierreDeMembresia = (typeof MOTIVOS_DE_CIERRE_DE_MEMBRESIA)[number];

export type MotivoFinDeMembresia = MotivoDeCierreDeMembresia | 'traslado';

/**
 * Aviso de privacidad que la PWA muestra antes de marcar el consentimiento.
 * El alta manda la `version` que mostró y la API rechaza otra. El texto es un
 * marcador sintético: el definitivo lo redacta SBA-16 con Cáritas.
 */
export const AVISO_DE_PRIVACIDAD = {
  version: 'sintetico-0',
  finalidad:
    'Registrar a la persona atendida y verificar que reciba ayuda de una sola institución del Banco.',
} as const;

/**
 * Datos de una persona. `numeroDocumento` admite puntos, guiones y espacios:
 * la API los quita y pasa a mayúsculas («1.088.123.456» → `1088123456`).
 * `fechaNacimiento` va como AAAA-MM-DD.
 */
export interface DatosDePersona {
  tipoDocumento: TipoDeDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  sexo: Sexo;
  fechaNacimiento: string;
  telefono?: string | null;
  direccion?: string | null;
}

/** Representante adulto de un menor. Si ya existe en el banco se reutiliza. */
export interface RepresentanteNuevo {
  persona: DatosDePersona;
  parentesco: Parentesco;
}

/**
 * Cuerpo de `POST /api/v1/beneficiarios`. Lo usan coordinación y admin_banco.
 *
 * Un menor de 18 años lleva al menos un representante; el primero otorga el
 * consentimiento por él. Sin `consentimiento.otorgado` el alta se rechaza.
 * No lleva `comandoId`: un reenvío encuentra a la persona por documento y su
 * membresía activa, y responde `ya_activa`.
 */
export interface RegistrarBeneficiario {
  institucionId: string;
  tipoPoblacionId: string;
  persona: DatosDePersona;
  representantes?: RepresentanteNuevo[];
  consentimiento: {
    otorgado: true;
    /** La de `AVISO_DE_PRIVACIDAD` que se mostró. */
    versionAviso: string;
  };
}

export interface MembresiaDto {
  id: string;
  beneficiarioId: string;
  institucionId: string;
  /** ISO 8601. */
  inicioEn: string;
  finEn: string | null;
  motivoFin: MotivoFinDeMembresia | null;
}

/**
 * Respuesta de `POST /api/v1/beneficiarios`: 201 con `creada`, 200 con
 * `ya_activa` (ya estaba activa en esa institución; no se escribió nada).
 */
export interface BeneficiarioRegistrado {
  resultado: 'creada' | 'ya_activa';
  personaId: string;
  membresia: MembresiaDto;
}

/**
 * `codigo` del 409 de `POST /api/v1/beneficiarios`, en el cuerpo junto a
 * `message`:
 *
 * - `duplicidad`: la persona tiene membresía activa en otra institución. Queda
 *   una alerta para coordinación; la respuesta no dice cuál institución.
 * - `tipo_distinto`: el número existe con otro tipo de documento. Lo revisa
 *   coordinación (paso de TI a CC, o dos personas con el mismo número).
 * - `registro_simultaneo`: otra alta de la misma persona terminó primero.
 *   Reintentar da el resultado correcto.
 */
export type CodigoDeRegistroRechazado = 'duplicidad' | 'tipo_distinto' | 'registro_simultaneo';

export interface RegistroRechazado {
  codigo: CodigoDeRegistroRechazado;
  message: string;
}

export interface PersonaDto {
  id: string;
  tipoDocumento: TipoDeDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  sexo: Sexo;
  /** AAAA-MM-DD. */
  fechaNacimiento: string;
  telefono: string | null;
  direccion: string | null;
}

export interface RepresentanteDto {
  persona: PersonaDto;
  parentesco: Parentesco;
}

/**
 * Cuerpo de `POST /api/v1/beneficiarios/busqueda`, la búsqueda antes de crear
 * (SBA-27). Va en el cuerpo y no en la URL: la URL termina en los logs de
 * acceso (Arquitectura 8.6).
 */
export interface BuscarPorDocumento {
  numeroDocumento: string;
}

/**
 * Respuesta de `POST /api/v1/beneficiarios/busqueda`, con 200. La consulta
 * queda en auditoría (RNF-M2-09).
 *
 * `persona` es `null` si el número no existe en el banco. `beneficiario` es
 * `null` si la persona existe solo como representante. `representantes` son
 * los vigentes.
 */
export interface FichaDeBeneficiario {
  persona: PersonaDto | null;
  beneficiario: {
    tipoPoblacionId: string;
    membresiaActiva: MembresiaDto | null;
    representantes: RepresentanteDto[];
  } | null;
}

/** Cuerpo de `POST /api/v1/membresias/:id/cerrar` (SBA-28). */
export interface CerrarMembresia {
  motivo: MotivoDeCierreDeMembresia;
}

/**
 * Cuerpo de `POST /api/v1/beneficiarios/:personaId/traslado`, solo
 * coordinación (SBA-28). Cierra la membresía activa con motivo `traslado` y
 * abre otra en `institucionId`. Responde la membresía nueva.
 */
export interface TrasladarBeneficiario {
  institucionId: string;
}

/**
 * `GET /api/v1/beneficiarios/:personaId/membresias`: el historial, de la más
 * reciente a la más antigua (SBA-28).
 */
export type HistorialDeMembresias = MembresiaDto[];
