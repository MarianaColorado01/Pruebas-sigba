import type { ClaveParametro, ParametroListado, RangoEtario } from '@sigba/shared-types';

/**
 * Cómo se lee y se escribe cada parámetro en la pantalla (SBA-87). La API
 * valida igual; aquí van el nombre, la ayuda y el input que corresponde.
 */
interface Definicion {
  nombre: string;
  ayuda: string;
  /** Sin `numero`, el valor es la lista de rangos etarios. */
  numero?: { unidad: string; min: number; max?: number; paso: number };
}

const DIAS = { unidad: 'días', min: 1, paso: 1 };

/** En el orden en que se muestran. */
export const PARAMETROS: Record<ClaveParametro, Definicion> = {
  aporte_solidario_pct: {
    nombre: 'Aporte solidario',
    ayuda: 'Porcentaje que se calcula sobre cada salida. Va de 0 a 10 %.',
    numero: { unidad: '%', min: 0, max: 10, paso: 0.01 },
  },
  semaforo_amarillo_dias: {
    nombre: 'Semáforo amarillo',
    ayuda: 'Días antes del vencimiento en que un lote pasa a amarillo.',
    numero: DIAS,
  },
  semaforo_rojo_dias: {
    nombre: 'Semáforo rojo',
    ayuda: 'Días antes del vencimiento en que un lote pasa a rojo.',
    numero: DIAS,
  },
  rangos_etarios: {
    nombre: 'Rangos etarios',
    ayuda:
      'Edades en años para caracterizar a la población. Van de menor a mayor, sin cruzarse, y el último puede quedar sin tope.',
  },
  factor_minorista: {
    nombre: 'Factor minorista',
    ayuda:
      'Solo se aplica a los precios cuando el Banco aprobó el método y la evidencia que lo respaldan.',
    numero: { unidad: '', min: 0.01, paso: 0.01 },
  },
  recordatorio_borrador_horas: {
    nombre: 'Recordatorio de borradores',
    ayuda: 'Horas que espera un borrador de recepción antes de que el sistema lo recuerde.',
    numero: { unidad: 'horas', min: 1, paso: 1 },
  },
  retencion_dias: {
    nombre: 'Retención',
    ayuda: 'Días que se conservan los registros que tienen plazo de retención.',
    numero: DIAS,
  },
};

export const CLAVES_EN_PANTALLA = Object.keys(PARAMETROS) as ClaveParametro[];

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** `2026-10-01` → «1 oct 2026», sin depender de cómo abrevie el navegador. */
export function fechaLegible(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return `${dia} ${MESES[(mes ?? 1) - 1]} ${anio}`;
}

/** El día de hoy en Colombia, que es el que usa la API para la vigencia. */
export const hoyEnBogota = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

export function valorLegible({ clave, valor }: Pick<ParametroListado, 'clave' | 'valor'>): string {
  if (typeof valor === 'number') {
    const unidad = PARAMETROS[clave].numero?.unidad;
    return unidad ? `${NUMERO.format(valor)} ${unidad}` : NUMERO.format(valor);
  }
  if (valor.length === 0) return 'Sin rangos';
  const rangos = valor.map(({ desde, hasta }) =>
    hasta === null ? `${desde} o más` : `${desde} a ${hasta}`,
  );
  return `${rangos.join(', ')} años`;
}

/** Lo que dice una versión del historial sobre su vigencia, visto desde `hoy`. */
export function vigenciaLegible(
  { fecha_inicio, fecha_fin }: { fecha_inicio: string; fecha_fin: string | null },
  hoy: string,
): string {
  if (fecha_inicio > hoy) return `Programada desde el ${fechaLegible(fecha_inicio)}`;
  if (fecha_fin === null) return `Vigente desde el ${fechaLegible(fecha_inicio)}`;
  const rango = `${fechaLegible(fecha_inicio)} al ${fechaLegible(fecha_fin)}`;
  return fecha_fin >= hoy ? `Vigente del ${rango}` : `Del ${rango}`;
}

/** Un número como lo escribe la gente en Colombia, con coma o punto decimal. */
export function leerNumero(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

/** Un rango como está en el formulario: texto, y `hasta` vacío si no tiene tope. */
export interface RangoEnEdicion {
  desde: string;
  hasta: string;
}

export const rangosEnEdicion = (rangos: RangoEtario[]): RangoEnEdicion[] =>
  rangos.map(({ desde, hasta }) => ({
    desde: String(desde),
    hasta: hasta === null ? '' : String(hasta),
  }));

const ENTERO = /^\d+$/;

/** Los rangos del formulario como los recibe la API, o `null` si alguna edad no es un entero. */
export function leerRangos(filas: RangoEnEdicion[]): RangoEtario[] | null {
  const rangos: RangoEtario[] = [];
  for (const { desde, hasta } of filas) {
    const tope = hasta.trim();
    if (!ENTERO.test(desde.trim()) || (tope && !ENTERO.test(tope))) return null;
    rangos.push({ desde: Number(desde), hasta: tope ? Number(tope) : null });
  }
  return rangos;
}
