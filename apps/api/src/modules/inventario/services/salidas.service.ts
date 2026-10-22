import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BodegasService, ParametrosLectura } from '../../plataforma/index.js';
import { ZONA_DEL_BANCO } from './precios.service.js';
import {
  type CargaDeSalida,
  type RegistrarSalida,
  type SalidaRegistrada,
  SalidasRepositorio,
  TIPOS_DE_DESPACHADOR,
} from './salida.js';
import { estadoDelLote } from './stock.service.js';
import { cantidadPositiva, kilos, uuid } from './validaciones.js';

/** El largo de la columna salida.despachador. */
const LARGO_DEL_DESPACHADOR = 200;

/**
 * Salida a institución (SBA-38, SBA-40, RF-M1-09, RF-M1-10, RF-M1-11).
 *
 * Valida el comando, la bodega activa y que cada lote sea del banco, de esa
 * referencia y no esté vencido. La institución activa la valida el
 * repositorio con `InstitucionesService` de beneficiarios (ADR-14), dentro de
 * la transacción y después de reclamar el comando. Lee el aporte solidario vigente hoy y le
 * pide al repositorio que escriba todo en una transacción. El celular reenvía
 * comandos: la misma carga devuelve la salida que ya quedó y otra carga con el
 * mismo `comandoId` responde 409.
 *
 * Si la bodega responde 404 o el lote ya venció, puede ser un reenvío que
 * llegó después: antes de responder se consulta el comando, como en la
 * recepción.
 */
@Injectable()
export class SalidasService {
  constructor(
    private readonly repositorio: SalidasRepositorio,
    private readonly bodegas: BodegasService,
    private readonly parametros: ParametrosLectura,
  ) {}

  async registrar(comando: RegistrarSalida): Promise<SalidaRegistrada> {
    const comandoId = uuid(comando.comandoId, 'El comando');
    const carga = cargaValida(comando);
    const despachador = despachadorValido(comando.despachador);
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_DEL_BANCO }).format(new Date());

    let equivalencias: string[];
    try {
      equivalencias = await this.validar(carga, hoy);
    } catch (error) {
      if (!(error instanceof NotFoundException || error instanceof ConflictException)) throw error;
      const previa = await this.repositorio.repetida(comandoId, carga);
      if (previa) return previa;
      throw error;
    }

    const aporte = await this.parametros.obtenerVigente('aporte_solidario_pct', hoy);
    return this.repositorio.registrar({
      comandoId,
      carga,
      despachador,
      kilos: carga.detalles.map((d, i) => kilos(d.cantidad, equivalencias[i] as string)),
      aportePct: aporte ? String(aporte.valor) : null,
      hoy,
    });
  }

  /**
   * Las instituciones activas del banco para elegir a quién se entrega. El
   * directorio completo es de la coordinación (`GET /instituciones`).
   */
  institucionesActivas() {
    return this.repositorio.institucionesActivas();
  }

  /**
   * Bodega y lotes; devuelve la equivalencia congelada de cada lote. La
   * institución la valida el repositorio dentro de la transacción.
   */
  private async validar(carga: CargaDeSalida, hoy: string): Promise<string[]> {
    // Sin FK a plataforma.bodega (ADR-05): la valida su dueño, con RLS por banco.
    await this.bodegas.obtenerActiva(carga.bodegaId);
    const lotes = new Map(
      (await this.repositorio.lotes(carga.detalles.map((d) => d.loteId))).map((l) => [l.loteId, l]),
    );

    return carga.detalles.map((detalle, i) => {
      const lote = lotes.get(detalle.loteId);
      if (!lote || lote.referenciaId !== detalle.referenciaId) {
        throw new NotFoundException(`Fila ${i + 1}: no existe ese lote o no es de esa referencia.`);
      }
      // Lo vencido se da de baja, no se entrega (SBA-37).
      if (estadoDelLote(lote.vencimiento, hoy) === 'vencido') {
        throw new ConflictException(
          `Fila ${i + 1}: el lote venció el ${lote.vencimiento}. Dalo de baja en vez de despacharlo.`,
        );
      }
      return lote.equivalenciaKg;
    });
  }
}

function cargaValida(comando: RegistrarSalida): CargaDeSalida {
  const institucionId = uuid(comando.institucionId, 'La institución');
  const bodegaId = uuid(comando.bodegaId, 'La bodega');
  if (!(TIPOS_DE_DESPACHADOR as readonly string[]).includes(comando.despachadorTipo)) {
    throw new BadRequestException(
      `Tipo de despachador desconocido. Debe ser uno de: ${TIPOS_DE_DESPACHADOR.join(', ')}.`,
    );
  }
  if (!comando.detalles?.length) {
    throw new BadRequestException('La salida necesita al menos una fila.');
  }

  const movimientos = new Set<string>();
  const lotes = new Set<string>();
  const detalles = comando.detalles.map((fila, i) => {
    const n = i + 1;
    const movimientoId = uuid(fila.movimientoId, `Fila ${n}: el movimiento`);
    if (movimientos.has(movimientoId)) {
      throw new BadRequestException(`Fila ${n}: el movimiento ya viene en otra fila.`);
    }
    movimientos.add(movimientoId);
    const loteId = uuid(fila.loteId, `Fila ${n}: el lote`);
    if (lotes.has(loteId)) {
      throw new BadRequestException(
        `Fila ${n}: ese lote ya viene en otra fila; suma las cantidades.`,
      );
    }
    lotes.add(loteId);
    const cantidad = cantidadPositiva(fila.cantidad);
    if (!cantidad) {
      throw new BadRequestException(
        `Fila ${n}: la cantidad debe ser mayor que cero, con punto decimal y hasta tres decimales.`,
      );
    }
    return {
      movimientoId,
      referenciaId: uuid(fila.referenciaId, `Fila ${n}: la referencia`),
      loteId,
      cantidad,
    };
  });

  return { institucionId, bodegaId, despachadorTipo: comando.despachadorTipo, detalles };
}

function despachadorValido(despachador: string): string {
  const limpio = typeof despachador === 'string' ? despachador.trim() : '';
  if (!limpio) throw new BadRequestException('Falta quién despachó.');
  if (limpio.length > LARGO_DEL_DESPACHADOR) {
    throw new BadRequestException(
      `El nombre de quien despachó no puede pasar de ${LARGO_DEL_DESPACHADOR} caracteres.`,
    );
  }
  return limpio;
}
