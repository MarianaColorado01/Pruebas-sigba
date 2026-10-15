import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BodegasService } from '../../plataforma/index.js';
import { DonantesService } from './donantes.service.js';
import {
  type CargaDeRecepcion,
  NOVEDADES,
  type Novedad,
  ORIGENES,
  type RecepcionRegistrada,
  RecepcionesRepositorio,
  type RegistrarRecepcion,
} from './recepcion.js';
import { ReferenciasService } from './referencias.service.js';
import { cantidadPositiva, kilos, uuid } from './validaciones.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** El largo de la columna lote.codigo. */
const LARGO_DEL_LOTE = 50;

/**
 * Recepción manual con red (SBA-24, RF-M1-01, RF-M1-02, Arquitectura 6.1).
 *
 * Valida el comando del celular, calcula los kilos y le pide al repositorio
 * que escriba recepción, lotes y un movimiento de entrada por fila en una sola
 * transacción. El celular reenvía comandos: el repositorio reclama `comandoId`
 * con la carga validada en `core.comando_procesado`, y la misma carga devuelve
 * lo que ya quedó; otra carga con la misma clave responde 409.
 *
 * Donante, bodega y referencias se validan antes de la transacción. Si alguno
 * responde 404, puede ser un reenvío que llegó después de que lo desactivaron:
 * antes de responder se consulta el comando, y si ya quedó con esta carga se
 * devuelve esa recepción. Si no, el celular la capturaría otra vez con otro
 * comando y el inventario quedaría duplicado.
 */
@Injectable()
export class RecepcionesService {
  constructor(
    private readonly repositorio: RecepcionesRepositorio,
    private readonly donantes: DonantesService,
    private readonly bodegas: BodegasService,
    private readonly referencias: ReferenciasService,
  ) {}

  async registrar(comando: RegistrarRecepcion): Promise<RecepcionRegistrada> {
    const comandoId = uuid(comando.comandoId, 'El comando');
    const carga = cargaValida(comando);

    let equivalencias: string[];
    try {
      equivalencias = await this.equivalencias(carga);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      const previa = await this.repositorio.repetida(comandoId, carga);
      if (previa) return previa;
      throw error;
    }
    return this.repositorio.registrar({
      comandoId,
      carga,
      kilos: carga.detalles.map((d, i) => kilos(d.cantidad, equivalencias[i] as string)),
      equivalencias,
    });
  }

  /** Valida donante, bodega y referencias activos; devuelve la equivalencia de cada fila. */
  private async equivalencias(carga: CargaDeRecepcion): Promise<string[]> {
    await this.donantes.obtenerActivo(carga.donanteId);
    // Sin FK a plataforma.bodega (ADR-05): la valida su dueño, con RLS por banco.
    await this.bodegas.obtenerActiva(carga.bodegaId);
    const equivalencias = new Map(
      (await this.referencias.activasPorId(carga.detalles.map((d) => d.referenciaId))).map((r) => [
        r.id,
        r.equivalenciaKg,
      ]),
    );

    return carga.detalles.map((detalle, i) => {
      const equivalenciaKg = equivalencias.get(detalle.referenciaId);
      if (!equivalenciaKg) {
        throw new NotFoundException(`Fila ${i + 1}: no existe esa referencia o está desactivada.`);
      }
      return equivalenciaKg;
    });
  }
}

function cargaValida(comando: RegistrarRecepcion): CargaDeRecepcion {
  const donanteId = uuid(comando.donanteId, 'El donante');
  if (!(ORIGENES as readonly string[]).includes(comando.origen)) {
    throw new BadRequestException(`Origen desconocido. Debe ser uno de: ${ORIGENES.join(', ')}.`);
  }
  const bodegaId = uuid(comando.bodegaId, 'La bodega');
  if (!comando.detalles?.length) {
    throw new BadRequestException('La recepción necesita al menos una fila.');
  }

  const movimientos = new Set<string>();
  const detalles = comando.detalles.map((fila, i) => {
    const n = i + 1;
    const movimientoId = uuid(fila.movimientoId, `Fila ${n}: el movimiento`);
    if (movimientos.has(movimientoId)) {
      throw new BadRequestException(`Fila ${n}: el movimiento ya viene en otra fila.`);
    }
    movimientos.add(movimientoId);

    return {
      movimientoId,
      referenciaId: uuid(fila.referenciaId, `Fila ${n}: la referencia`),
      cantidad: cantidadValida(fila.cantidad, n),
      lote: loteLimpio(fila.lote, n),
      vencimiento: fechaValida(fila.vencimiento, n),
      novedad: novedadValida(fila.novedad, n),
    };
  });

  return { donanteId, origen: comando.origen, bodegaId, detalles };
}

function cantidadValida(cantidad: string | number, fila: number): string {
  const valida = cantidadPositiva(cantidad);
  if (!valida) {
    throw new BadRequestException(
      `Fila ${fila}: la cantidad debe ser mayor que cero, con punto decimal y hasta tres decimales.`,
    );
  }
  return valida;
}

function loteLimpio(lote: string | null | undefined, fila: number): string | null {
  const limpio = lote?.trim() || null;
  if (limpio && limpio.length > LARGO_DEL_LOTE) {
    throw new BadRequestException(
      `Fila ${fila}: el lote no puede pasar de ${LARGO_DEL_LOTE} caracteres.`,
    );
  }
  return limpio;
}

/**
 * AAAA-MM-DD y una fecha que existe: el 30 de febrero no pasa. Sin fecha queda
 * nulo: aseo y no alimentos llegan sin vencimiento.
 */
function fechaValida(fecha: string | null | undefined, fila: number): string | null {
  if (fecha === null || fecha === undefined || fecha === '') return null;
  const instante =
    typeof fecha === 'string' && FECHA.test(fecha) ? Date.parse(`${fecha}T00:00Z`) : NaN;
  const valida = !Number.isNaN(instante) && new Date(instante).toISOString().startsWith(fecha);
  if (!valida) {
    throw new BadRequestException(
      `Fila ${fila}: la fecha de vencimiento no es válida (AAAA-MM-DD).`,
    );
  }
  return fecha;
}

function novedadValida(novedad: Novedad | null | undefined, fila: number): Novedad | null {
  if (novedad === null || novedad === undefined) return null;
  if (!(NOVEDADES as readonly string[]).includes(novedad)) {
    throw new BadRequestException(
      `Fila ${fila}: novedad desconocida. Debe ser una de: ${NOVEDADES.join(', ')}.`,
    );
  }
  return novedad;
}
