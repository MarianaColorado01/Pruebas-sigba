import type { AccionDeAuditoria, RegistroDeAuditoria, TipoDeActor } from '@sigba/shared-types';

/** Filtros de la pantalla. Las fechas son días locales `AAAA-MM-DD`, ambos incluidos. */
export interface FiltrosDeAuditoria {
  accion?: AccionDeAuditoria;
  tipoActor?: TipoDeActor;
  actor?: string;
  entidad?: string;
  desde?: string;
  hasta?: string;
}

const CLAVES = ['accion', 'tipoActor', 'actor', 'entidad', 'desde', 'hasta'] as const;

/** Los filtros viven en la URL: se comparten y sobreviven a recargar. */
export function filtrosDeUrl(parametros: URLSearchParams): FiltrosDeAuditoria {
  const filtros: Record<string, string> = {};
  for (const clave of CLAVES) {
    const valor = parametros.get(clave);
    if (valor) filtros[clave] = valor;
  }
  return filtros as FiltrosDeAuditoria;
}

export function urlDeFiltros(filtros: FiltrosDeAuditoria): URLSearchParams {
  const parametros = new URLSearchParams();
  for (const clave of CLAVES) {
    const valor = filtros[clave];
    if (valor) parametros.set(clave, valor);
  }
  return parametros;
}

/** Medianoche local de `AAAA-MM-DD`, más `dias`, como instante ISO. */
function inicioDelDia(dia: string, dias = 0): string {
  const [anio, mes, fecha] = dia.split('-').map(Number);
  return new Date(anio ?? 0, (mes ?? 1) - 1, (fecha ?? 1) + dias).toISOString();
}

/**
 * La API recibe `[desde, hasta)` en instantes; la pantalla, días locales
 * incluidos. `hasta` pasa al inicio del día siguiente.
 */
export function rangoParaApi(desde?: string, hasta?: string): { desde?: string; hasta?: string } {
  return {
    ...(desde && { desde: inicioDelDia(desde) }),
    ...(hasta && { hasta: inicioDelDia(hasta, 1) }),
  };
}

export function consultaParaApi(filtros: FiltrosDeAuditoria, cursor?: string): string {
  const { desde, hasta, ...resto } = filtros;
  const parametros = urlDeFiltros(resto);
  for (const [clave, valor] of Object.entries(rangoParaApi(desde, hasta))) {
    parametros.set(clave, valor);
  }
  if (cursor) parametros.set('cursor', cursor);
  const texto = parametros.toString();
  return texto ? `/auditoria?${texto}` : '/auditoria';
}

const VERBOS: Record<AccionDeAuditoria, string> = {
  crear: 'creó',
  actualizar: 'actualizó',
  eliminar: 'eliminó',
  leer: 'consultó',
};

export const NOMBRES_DE_ACCION: Record<AccionDeAuditoria, string> = {
  crear: 'Creaciones',
  actualizar: 'Cambios',
  eliminar: 'Eliminaciones',
  leer: 'Lecturas',
};

/** `beneficiarios_de_institucion` → `beneficiarios de institucion`. */
export function legible(codigo: string): string {
  return codigo.replaceAll('_', ' ');
}

export function nombreDeActor(registro: RegistroDeAuditoria): string {
  if (registro.tipoActor === 'sistema') {
    return `Sistema · ${legible((registro.actorEtiqueta ?? '').replace(/^sistema:/, ''))}`;
  }
  return registro.actorNombre ?? `Usuario ${registro.actorId?.slice(0, 8) ?? ''}`.trim();
}

/** Lo que pasó, sin el actor: «consultó 12 registros de beneficiario». */
export function queHizo(registro: RegistroDeAuditoria): string {
  const entidad = legible(registro.entidad);
  const cantidad = registro.detalle?.cantidad;
  if (registro.accion === 'leer' && cantidad !== undefined) {
    return `${VERBOS.leer} ${cantidad} ${cantidad === 1 ? 'registro' : 'registros'} de ${entidad}`;
  }
  return `${VERBOS[registro.accion]} ${entidad}`;
}

const DIA_LOCAL = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short' });
const NOMBRE_DEL_DIA = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Día local `AAAA-MM-DD` de un instante. */
export function diaLocal(instante: string | Date): string {
  return DIA_LOCAL.format(new Date(instante));
}

export function tituloDelDia(dia: string, hoy = new Date()): string {
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (dia === diaLocal(hoy)) return 'Hoy';
  if (dia === diaLocal(ayer)) return 'Ayer';
  const [anio, mes, fecha] = dia.split('-').map(Number);
  const nombre = NOMBRE_DEL_DIA.format(new Date(anio ?? 0, (mes ?? 1) - 1, fecha ?? 1));
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

/** Agrupa por día local, conservando el orden en que llegan (más reciente primero). */
export function agruparPorDia(
  registros: readonly RegistroDeAuditoria[],
): { dia: string; registros: RegistroDeAuditoria[] }[] {
  const grupos: { dia: string; registros: RegistroDeAuditoria[] }[] = [];
  for (const registro of registros) {
    const dia = diaLocal(registro.ocurridoEn);
    const ultimo = grupos.at(-1);
    if (ultimo?.dia === dia) ultimo.registros.push(registro);
    else grupos.push({ dia, registros: [registro] });
  }
  return grupos;
}
