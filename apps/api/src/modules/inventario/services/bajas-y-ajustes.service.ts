import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BodegasService } from '../../plataforma/index.js';
import {
  BajasYAjustesRepositorio,
  type CargaDeMovimientoManual,
  MOTIVOS_DE_BAJA,
  type MovimientoManualRegistrado,
  type RegistrarAjuste,
  type RegistrarBaja,
  type TipoDeMovimientoManual,
} from './baja-y-ajuste.js';
import { cantidadPositiva, kilos, uuid } from './validaciones.js';

/** El largo de la columna ajuste.motivo. */
const LARGO_DEL_MOTIVO = 500;

/**
 * Bajas por producto no apto y ajustes de conteo (SBA-42, ADR-08).
 *
 * Valida el comando, calcula los kilos con la equivalencia congelada en el
 * lote y le pide al repositorio que escriba el movimiento y su motivo en
 * una transacción. El celular reenvía comandos: la misma carga devuelve lo
 * que ya quedó y otra carga con el mismo `comandoId` responde 409, como en la
 * recepción. Una baja mayor que el saldo la rechaza el libro con 409.
 */
@Injectable()
export class BajasYAjustesService {
  constructor(
    private readonly repositorio: BajasYAjustesRepositorio,
    private readonly bodegas: BodegasService,
  ) {}

  async darDeBaja(comando: RegistrarBaja): Promise<MovimientoManualRegistrado> {
    const cantidad = cantidadPositiva(comando.cantidad);
    if (!cantidad) {
      throw new BadRequestException(
        'La cantidad de la baja debe ser mayor que cero, con punto decimal y hasta tres decimales.',
      );
    }
    if (!(MOTIVOS_DE_BAJA as readonly string[]).includes(comando.motivo)) {
      throw new BadRequestException(
        `Motivo de baja desconocido. Debe ser uno de: ${MOTIVOS_DE_BAJA.join(', ')}.`,
      );
    }
    return this.registrar('baja', comando, { cantidad, resta: true }, comando.motivo);
  }

  async ajustar(comando: RegistrarAjuste): Promise<MovimientoManualRegistrado> {
    const texto = String(comando.cantidad).trim();
    const negativa = texto.startsWith('-');
    const cantidad = cantidadPositiva(negativa ? texto.slice(1) : texto);
    if (!cantidad) {
      throw new BadRequestException(
        'La cantidad del ajuste no puede ser cero: positiva si sobra, negativa si falta, con punto decimal y hasta tres decimales.',
      );
    }
    const motivo = typeof comando.motivo === 'string' ? comando.motivo.trim() : '';
    if (!motivo) {
      throw new BadRequestException('El ajuste necesita un motivo.');
    }
    if (motivo.length > LARGO_DEL_MOTIVO) {
      throw new BadRequestException(
        `El motivo del ajuste no puede pasar de ${LARGO_DEL_MOTIVO} caracteres.`,
      );
    }
    return this.registrar('ajuste', comando, { cantidad, resta: negativa }, motivo);
  }

  private async registrar(
    tipo: TipoDeMovimientoManual,
    comando: RegistrarBaja | RegistrarAjuste,
    { cantidad, resta }: { cantidad: string; resta: boolean },
    motivo: string,
  ): Promise<MovimientoManualRegistrado> {
    const comandoId = uuid(comando.comandoId, 'El comando');
    const carga: CargaDeMovimientoManual = {
      movimientoId: uuid(comando.movimientoId, 'El movimiento'),
      bodegaId: uuid(comando.bodegaId, 'La bodega'),
      referenciaId: uuid(comando.referenciaId, 'La referencia'),
      loteId: uuid(comando.loteId, 'El lote'),
      cantidad: conSigno(cantidad, resta),
      motivo,
    };

    // Si la bodega se desactivó después del primer envío, el reenvío no es
    // un 404: devuelve lo que ya quedó, o 409 si la carga es otra.
    let equivalenciaKg: string;
    try {
      equivalenciaKg = await this.equivalencia(carga);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
      const previo = await this.repositorio.repetido(tipo, comandoId, carga);
      if (previo) return previo;
      throw error;
    }

    return this.repositorio.registrar({
      tipo,
      comandoId,
      carga,
      kilos: conSigno(kilos(cantidad, equivalenciaKg), resta),
    });
  }

  /** Valida bodega activa y lote de la referencia; devuelve la equivalencia del lote. */
  private async equivalencia(carga: CargaDeMovimientoManual): Promise<string> {
    // Sin FK a plataforma.bodega (ADR-05): la valida su dueño, con RLS por banco.
    await this.bodegas.obtenerActiva(carga.bodegaId);
    const equivalenciaKg = await this.repositorio.equivalenciaDelLote(
      carga.loteId,
      carga.referenciaId,
    );
    if (!equivalenciaKg) {
      throw new NotFoundException('No existe ese lote o no es de esa referencia.');
    }
    return equivalenciaKg;
  }
}

/** Lo que resta entra al libro en negativo; el saldo es la suma. */
function conSigno(valor: string, resta: boolean): string {
  return resta ? `-${valor}` : valor;
}
