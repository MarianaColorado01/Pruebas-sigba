import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type ClaveParametro,
  type ClaveParametroLectura,
  type ParametroHistorial,
  type ParametroListado,
  type ParametroVigente,
  type RangoEtario,
  type ResultadoParametro,
  type ValorParametro,
} from '@sigba/shared-types';
import { getTenantContext } from '../../../core/index.js';
import { ParametrosRepositorio } from './parametros.repositorio.js';

type Validador = (valor: unknown) => boolean;

export abstract class ParametrosLectura {
  /**
   * @deprecated Usa `consultarVigente`, que devuelve el `parametroId` que el
   * movimiento debe guardar y valida el valor leído (SBA-34).
   */
  abstract obtenerVigente<K extends ClaveParametro>(
    clave: K,
    fecha?: string,
  ): Promise<ParametroVigente<K> | null>;

  abstract listarVigentes(fecha?: string): Promise<ParametroListado[]>;

  /**
   * Versión vigente de `clave` en el día de Bogotá que contiene `fecha`.
   * Contrato en docs/arquitectura/contratos/plataforma-lectura.md.
   *
   * No es abstracto porque los dobles de prueba de inventario heredan de esta
   * clase y no lo implementan; `ParametrosService` lo sobrescribe.
   *
   * @throws ValorParametroAlmacenadoInvalido
   * @throws VigenciaDuplicada
   */
  consultarVigente<K extends ClaveParametroLectura>(
    _clave: K,
    _fecha: Date,
  ): Promise<ResultadoParametro<K>> {
    return Promise.reject(new Error('consultarVigente no está implementado.'));
  }
}

/** La versión vigente tiene un valor que no cumple la forma de su clave. */
export class ValorParametroAlmacenadoInvalido extends Error {
  constructor(
    readonly clave: ClaveParametro,
    readonly parametroId: string,
  ) {
    super(`El valor guardado de ${clave} (${parametroId}) no tiene la forma esperada.`);
  }
}

/**
 * Hay más de una versión vigente de la clave en el mismo día. La restricción
 * `parametro_banco_sin_solapamiento` lo impide; si pasa, no se elige una.
 */
export class VigenciaDuplicada extends Error {
  constructor(
    readonly clave: ClaveParametro,
    readonly fecha: string,
    readonly parametroIds: string[],
  ) {
    super(`Hay ${parametroIds.length} versiones vigentes de ${clave} el ${fecha}.`);
  }
}

export class ParametroDesconocido extends BadRequestException {
  constructor(clave: string) {
    super(`Clave de parámetro desconocida: ${clave}.`);
  }
}

export class ValorParametroInvalido extends BadRequestException {
  constructor(clave: ClaveParametro) {
    super(`El valor no es válido para ${clave}.`);
  }
}

const esNumeroFinito = (valor: unknown): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor);
const esEnteroPositivo = (valor: unknown): valor is number =>
  esNumeroFinito(valor) && Number.isInteger(valor) && valor > 0;

// TODO(SBA-20): confirmar el formato de rangos_etarios cuando el Banco defina sus rangos.
function sonRangosEtarios(valor: unknown): valor is RangoEtario[] {
  if (!Array.isArray(valor)) return false;
  let limiteAnterior: number | null = null;

  for (const rango of valor as unknown[]) {
    if (
      typeof rango !== 'object' ||
      rango === null ||
      Array.isArray(rango) ||
      Object.keys(rango).length !== 2 ||
      !('desde' in rango) ||
      !('hasta' in rango) ||
      typeof rango.desde !== 'number' ||
      !Number.isInteger(rango.desde) ||
      rango.desde < 0 ||
      (rango.hasta !== null &&
        (typeof rango.hasta !== 'number' ||
          !Number.isInteger(rango.hasta) ||
          rango.hasta < rango.desde)) ||
      (limiteAnterior !== null && rango.desde <= limiteAnterior)
    ) {
      return false;
    }
    if (limiteAnterior === null && rango !== valor[0]) return false;
    limiteAnterior = rango.hasta;
  }

  return true;
}

const CATALOGO_PARAMETROS: Record<ClaveParametro, Validador> = {
  aporte_solidario_pct: (valor) => esNumeroFinito(valor) && valor >= 0 && valor <= 10,
  semaforo_rojo_dias: esEnteroPositivo,
  semaforo_amarillo_dias: esEnteroPositivo,
  rangos_etarios: sonRangosEtarios,
  factor_minorista: (valor) => esNumeroFinito(valor) && valor > 0,
  recordatorio_borrador_horas: esEnteroPositivo,
  retencion_dias: esEnteroPositivo,
};

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const FORMATEADOR_BOGOTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Día calendario (YYYY-MM-DD) de `ahora` en Bogotá, que es UTC−5 todo el año. */
export function fechaDeBogota(ahora = new Date()): string {
  const partes = Object.fromEntries(
    FORMATEADOR_BOGOTA.formatToParts(ahora).map(({ type, value }) => [type, value]),
  );
  return `${partes['year']}-${partes['month']}-${partes['day']}`;
}

function validarFecha(fecha: string): string {
  if (!FECHA_ISO.test(fecha) || fecha.startsWith('0000-')) {
    throw new BadRequestException('La fecha debe tener el formato YYYY-MM-DD.');
  }
  const fechaUtc = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(fechaUtc.valueOf()) || fechaUtc.toISOString().slice(0, 10) !== fecha) {
    throw new BadRequestException('La fecha no es válida.');
  }
  return fecha;
}

function claveValida(clave: string): clave is ClaveParametro {
  return Object.hasOwn(CATALOGO_PARAMETROS, clave);
}

function validarClave(clave: string): asserts clave is ClaveParametro {
  if (!claveValida(clave)) {
    throw new ParametroDesconocido(clave);
  }
}

@Injectable()
export class ParametrosService extends ParametrosLectura {
  constructor(private readonly repositorio: ParametrosRepositorio) {
    super();
  }

  async obtenerVigente<K extends ClaveParametro>(
    clave: K,
    fecha?: string,
  ): Promise<ParametroVigente<K> | null> {
    validarClave(clave);
    const fechaConsultada = validarFecha(fecha ?? fechaDeBogota());
    const fila = await this.repositorio.obtenerVigente(clave, fechaConsultada);
    return fila
      ? {
          valor: fila.valor,
          version: fila.version,
          fecha_inicio: fila.fechaInicio,
          fecha_fin: fila.fechaFin,
        }
      : null;
  }

  override async consultarVigente<K extends ClaveParametroLectura>(
    clave: K,
    fecha: Date,
  ): Promise<ResultadoParametro<K>> {
    validarClave(clave);
    // Sin banco, RLS devolvería cero filas y se confundiría con «sin valor vigente».
    if (!getTenantContext()?.bancoId) {
      throw new Error('Consulta de parámetros sin banco en el contexto de tenant.');
    }
    if (Number.isNaN(fecha.valueOf())) throw new BadRequestException('La fecha no es válida.');
    const dia = fechaDeBogota(fecha);

    const filas = await this.repositorio.vigentesEn(clave, dia);
    const [fila] = filas;
    if (!fila) return { encontrado: false, clave, motivo: 'SIN_VALOR_VIGENTE', fecha: dia };
    if (filas.length > 1) {
      throw new VigenciaDuplicada(
        clave,
        dia,
        filas.map(({ id }) => id),
      );
    }
    if (!CATALOGO_PARAMETROS[clave](fila.valor)) {
      throw new ValorParametroAlmacenadoInvalido(clave, fila.id);
    }

    return {
      encontrado: true,
      clave,
      valor: fila.valor,
      parametroId: fila.id,
      version: fila.version,
      fechaInicio: fila.fechaInicio,
      fechaFin: fila.fechaFin,
    };
  }

  async listarVigentes(fecha?: string): Promise<ParametroListado[]> {
    const fechaConsultada = validarFecha(fecha ?? fechaDeBogota());
    const filas = await this.repositorio.listarVigentes(fechaConsultada);
    return filas.map((fila) => ({
      clave: fila.clave,
      valor: fila.valor,
      version: fila.version,
      fecha_inicio: fila.fechaInicio,
      fecha_fin: fila.fechaFin,
    })) as ParametroListado[];
  }

  async historial(clave: string): Promise<ParametroHistorial[]> {
    validarClave(clave);
    const filas = await this.repositorio.historial(clave);
    return filas.map((fila) => ({
      clave: fila.clave,
      valor: fila.valor,
      version: fila.version,
      fecha_inicio: fila.fechaInicio,
      fecha_fin: fila.fechaFin,
    })) as ParametroHistorial[];
  }

  /**
   * Escritura administrativa (solo `admin_banco`), sin `comandoId`; la
   * idempotencia es natural y la decide `decidirEscritura`:
   * mismo valor y misma fecha de inicio → devuelve la versión existente;
   * otro valor para una vigencia que aún no empieza → corrige esa versión;
   * otro valor para una vigencia ya empezada → 409, se corrige con una versión nueva.
   */
  async actualizar<K extends ClaveParametro>(
    clave: K,
    valor: unknown,
    fechaInicio?: string,
  ): Promise<ParametroVigente<K>> {
    validarClave(clave);
    if (!CATALOGO_PARAMETROS[clave](valor)) {
      throw new ValorParametroInvalido(clave);
    }

    const hoy = fechaDeBogota();
    const inicio = validarFecha(fechaInicio ?? hoy);

    const fila = await this.repositorio.actualizar(clave, valor as ValorParametro[K], inicio, hoy);
    return {
      valor: fila.valor,
      version: fila.version,
      fecha_inicio: fila.fechaInicio,
      fecha_fin: fila.fechaFin,
    };
  }
}
