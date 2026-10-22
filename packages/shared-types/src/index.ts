/**
 * Contratos compartidos entre la API y la PWA: DTO, enums y eventos.
 *
 * Todo lo que cruza la frontera entre `apps/api` y `apps/web` vive aquí, para
 * que el tipo se defina una sola vez (Arquitectura 5.3).
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

/**
 * Una asignación activa de la persona en un banco activo, como la devuelve
 * `GET /api/v1/yo/asignaciones`. La PWA la usa para elegir con qué banco
 * trabajar. `super_admin` va sin banco.
 */
export interface AsignacionDeUsuario {
  rol: Rol;
  bancoId: string | null;
  bancoNombre: string | null;
  institucionId: string | null;
}

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
 * Banco de la red, como lo devuelve `GET /bancos` (SBA-19, D11). El código va
 * en mayúsculas y es único en la red.
 */
export interface BancoDto {
  id: string;
  nombre: string;
  codigo: string;
  activo: boolean;
}

/**
 * Bodega de un banco, como la devuelve `GET /bodegas` (SBA-19, D10). Una
 * bodega inactiva no se ofrece para movimientos nuevos, pero no se borra.
 */
export interface BodegaDto {
  id: string;
  nombre: string;
  direccion: string | null;
  activa: boolean;
}

export type TipoDeInstitucion = 'parroquia' | 'comunidad_religiosa' | 'fundacion';

export type DiaDeRecogida =
  'lunes' | 'martes' | 'miercoles' | 'jueves' | 'viernes' | 'sabado' | 'domingo';

/**
 * Institución del directorio del banco, como la devuelve `GET /instituciones`
 * (SBA-26, RF-M2-01). Una inactiva no se borra: las salidas pasadas la nombran.
 */
export interface InstitucionDto {
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
  /** ISO 8601. */
  actualizadoEn: string | null;
}

/** Tipo de población del banco, como lo devuelve `GET /tipos-de-poblacion` (SBA-86). */
export interface TipoDePoblacionDto {
  id: string;
  nombre: string;
  activo: boolean;
}

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

/**
 * Roles que `admin_banco` invita a su banco (D8). `super_admin` se asigna por
 * SQL e `institucion` se invita desde el directorio de instituciones.
 */
export const ROLES_INVITABLES_POR_ADMIN = [
  'admin_banco',
  'coordinacion',
  'operario_bodega',
  'voluntario',
  'consulta',
] as const satisfies readonly Rol[];

export type RolInvitablePorAdmin = (typeof ROLES_INVITABLES_POR_ADMIN)[number];

/**
 * Respuesta de crear y de reenviar una invitación (D1, D4). El enlace es el
 * canal principal; `correoEnviado` dice si además salió por correo.
 *
 * Invitar otra vez a un correo con invitación pendiente y los mismos datos
 * devuelve esa invitación con 200 y `yaExistia`: sin correo y sin enlace,
 * porque solo se guarda el hash del token. Reenviar da un enlace nuevo.
 */
export interface InvitacionEmitida {
  invitacionId: string;
  enlace: string | null;
  /** ISO 8601. */
  venceEn: string;
  correoEnviado: boolean;
  yaExistia: boolean;
}

/** `vencida` es una pendiente cuyo enlace ya no sirve: se puede reenviar. */
export type EstadoDeInvitacion = 'pendiente' | 'vencida' | 'aceptada';

/** Una fila de `GET /api/v1/invitaciones`. Las revocadas no aparecen. */
export interface InvitacionDelBanco {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  estado: EstadoDeInvitacion;
  venceEn: string;
  creadoEn: string;
  aceptadaEn: string | null;
  /** Quién aceptó, para notar si el enlace llegó a otra persona (D3). */
  aceptadaPorNombre: string | null;
}

/**
 * Por qué no sirve un enlace de invitación. Llega en `codigo` de
 * `POST /api/v1/invitaciones/aceptar`. Con 410, el enlace mismo: `no_existe`,
 * `vencida`, `usada` o `revocada`. `correo_en_uso` llega con 409: otra cuenta
 * de SIGBA ya tiene el correo de la invitación. Con 403, la cuenta: su correo
 * no está verificado o no es al que se invitó, o la cuenta o el banco están
 * inactivos.
 */
export type MotivoDeInvitacionRechazada =
  | 'no_existe'
  | 'vencida'
  | 'usada'
  | 'revocada'
  | 'correo_en_uso'
  | 'correo_no_verificado'
  | 'correo_no_coincide'
  | 'usuario_inactivo'
  | 'banco_inactivo';

export interface InvitacionAceptada {
  bancoId: string;
  rol: Rol;
}

/** Una asignación activa en el banco, como la lista `GET /api/v1/usuarios`. */
export interface UsuarioDelBanco {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  institucionId: string | null;
  /** ISO 8601: desde cuándo tiene la asignación. */
  desde: string;
}

/**
 * Eventos de dominio v1, tal como los describe `docs/eventos/contratos.v1.json`
 * (SBA-30, ADR-09). El emisor los escribe en `core.outbox` dentro de su
 * transacción y los consumidores los reciben por el despachador.
 *
 * Las cargas llevan identificadores, nunca datos personales (Arquitectura 8.6).
 * Cambiar una carga es cambiar el contrato: piden acuerdo del emisor, de los
 * consumidores y de arquitectura. Un cambio incompatible es una versión nueva.
 */

/** Una línea de un movimiento: cuánto de qué referencia salió o entró de qué lote. */
export type DetalleDeEvento = {
  referenciaId: string;
  loteId: string;
  /** Mayor que cero. */
  cantidad: number;
};

/**
 * Una línea recibida. Sin precio aprobado vigente el día de la recepción,
 * `valorUnitario` e `importe` van en `null`: valoración pendiente, nunca cero
 * (ADR-13). Si después se aprueba un precio, llega en `PrecioActualizado`.
 */
export type DetalleDeRecepcionConfirmada = DetalleDeEvento & {
  categoriaId: string;
  /** Mayor que cero. */
  kilos: number;
  /** Decimal en texto. */
  valorUnitario: string | null;
  /** Decimal en texto: cantidad por valor unitario. */
  importe: string | null;
};

export type RecepcionConfirmadaV1 = {
  tipo: 'RecepcionConfirmada';
  version: 1;
  payload: {
    recepcionId: string;
    bodegaId: string;
    donanteId: string;
    origen: 'propia' | 'abaco' | 'plataforma';
    /** Al menos uno. */
    detalles: DetalleDeRecepcionConfirmada[];
  };
};

/**
 * Una línea entregada, con los mismos campos que la recepción. Sin precio
 * aprobado vigente el día en que la API recibe la salida, `valorUnitario`,
 * `importe` y `aporte` van en `null`: valoración pendiente, nunca cero
 * (ADR-13). Sin `aporte_solidario_pct` vigente, solo `aporte` va en `null`.
 */
export type DetalleDeSalidaRegistrada = DetalleDeEvento & {
  categoriaId: string;
  /** Mayor que cero. */
  kilos: number;
  /** Decimal en texto. */
  valorUnitario: string | null;
  /** Decimal en texto: cantidad por valor unitario. */
  importe: string | null;
  /** Decimal en texto: importe por el porcentaje de aporte solidario. */
  aporte: string | null;
};

export type SalidaRegistradaV1 = {
  tipo: 'SalidaRegistrada';
  version: 1;
  payload: {
    salidaId: string;
    institucionId: string;
    bodegaId: string;
    despachadorTipo: 'funcionario' | 'voluntario';
    /** Al menos uno. */
    detalles: DetalleDeSalidaRegistrada[];
  };
};

export type PrecioActualizadoV1 = {
  tipo: 'PrecioActualizado';
  version: 1;
  payload: {
    precioId: string;
    referenciaId: string;
    /** Decimal en texto, con hasta dos decimales: `"2500.00"`. */
    valor: string;
    moneda: 'COP';
    /** Día `AAAA-MM-DD`, en Colombia. */
    vigenteDesde: string;
    /**
     * Entradas pendientes que este precio valoró al aprobarse (valoración
     * tardía, SBA-43). Vacío si no había ninguna.
     */
    valoraciones: { loteId: string; valorUnitario: string; importe: string }[];
  };
};

type CargaDeMembresia = {
  membresiaId: string;
  beneficiarioId: string;
  institucionId: string;
};

export type MembresiaActivadaV1 = {
  tipo: 'MembresiaActivada';
  version: 1;
  payload: CargaDeMembresia;
};

export type MembresiaCerradaV1 = {
  tipo: 'MembresiaCerrada';
  version: 1;
  payload: CargaDeMembresia;
};

/** Los eventos que hoy se emiten o se consumen. */
export type EventoV1 =
  | RecepcionConfirmadaV1
  | SalidaRegistradaV1
  | PrecioActualizadoV1
  | MembresiaActivadaV1
  | MembresiaCerradaV1;

export type TipoDeEvento = EventoV1['tipo'];

export * from './beneficiarios.js';
