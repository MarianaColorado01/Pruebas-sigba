import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AprobarPrecio,
  type CargaDePrecio,
  FUENTES,
  type Precio,
  type PrecioGuardado,
  type PrecioRegistrado,
  PreciosRepositorio,
  type ProponerPrecio,
} from './precio.js';

/**
 * Lo que dura un precio si la propuesta no trae fin de vigencia, contando el
 * primer día. ADR-13 deja vigencia y bandas abiertas: este valor pasará a
 * `ParametrosService` por banco (SBA-34) cuando exista.
 */
export const DIAS_DE_VIGENCIA = 30;

/** El calendario del Banco: el día cambia a medianoche en Colombia, no en UTC. */
const ZONA_DEL_BANCO = 'America/Bogota';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decimal(14,2): hasta doce enteros y dos decimales, con punto. */
const PESOS = /^\d{1,12}(\.\d{1,2})?$/;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Una referencia y una fecha: con qué precio se valora, o pendiente si no hay. */
export interface PrecioParaValorar {
  referenciaId: string;
  fecha: string;
  /** Sin precio aprobado vigente la valoración queda pendiente, nunca en cero (ADR-13). */
  valoracion: 'pendiente' | 'con_precio';
  precio: Precio | null;
}

export interface PrecioConRepeticion {
  precio: Precio;
  repetida: boolean;
}

/**
 * Maestro de precios por referencia genérica (SBA-39, ADR-13).
 *
 * La coordinación propone un valor con piso, techo, fuente y evidencia, y lo
 * aprueba; si el valor cae fuera de la banda, aprobarlo exige motivo. Para
 * valorar solo sirve un aprobado cuya vigencia cubre la fecha: un propuesto o
 * un vencido dejan la valoración pendiente, nunca en cero. Las dos escrituras
 * son idempotentes por `comandoId`, como la recepción.
 */
@Injectable()
export class PreciosService {
  constructor(private readonly repositorio: PreciosRepositorio) {}

  async proponer(comando: ProponerPrecio): Promise<PrecioConRepeticion> {
    const comandoId = uuid(comando.comandoId, 'El comando');
    const carga = cargaValida(comando);
    return conEstado(
      await this.repositorio.proponer({
        comandoId,
        carga,
        vigenteHasta: carga.vigenteHasta ?? sumarDias(carga.vigenteDesde, DIAS_DE_VIGENCIA - 1),
      }),
    );
  }

  /**
   * La banda se revisa antes de la transacción: valor, piso y techo no cambian
   * después de proponer (los protege un trigger), así que un reenvío recibe la
   * misma respuesta. La base tiene el mismo control como CHECK.
   */
  async aprobar(comando: AprobarPrecio): Promise<PrecioConRepeticion> {
    const comandoId = uuid(comando.comandoId, 'El comando');
    const precioId = uuid(comando.precioId, 'El precio');
    const motivoFueraDeBanda = comando.motivoFueraDeBanda?.trim() || null;

    const precio = await this.repositorio.obtener(precioId);
    if (!precio) throw new NotFoundException('No existe ese precio.');
    if (fueraDeBanda(precio) && !motivoFueraDeBanda) {
      throw new BadRequestException(
        `El valor ${precio.valor} está fuera de la banda de ${precio.piso} a ${precio.techo}. ` +
          'Para aprobarlo escribe el motivo.',
      );
    }

    return conEstado(
      await this.repositorio.aprobar({ comandoId, carga: { precioId, motivoFueraDeBanda } }),
    );
  }

  async historial(referenciaId: string): Promise<Precio[]> {
    const precios = await this.repositorio.historial(uuid(referenciaId, 'La referencia'));
    const hoy = hoyEnColombia();
    return precios.map((precio) => estadoEn(precio, hoy));
  }

  /** Sin fecha, la de hoy en Colombia. */
  async vigente(referenciaId: string, fecha?: string): Promise<PrecioParaValorar> {
    const id = uuid(referenciaId, 'La referencia');
    const dia = fecha === undefined ? hoyEnColombia() : fechaValida(fecha, 'La fecha');
    const precio = await this.repositorio.aprobadoEn(id, dia);
    return {
      referenciaId: id,
      fecha: dia,
      valoracion: precio ? 'con_precio' : 'pendiente',
      precio: precio && estadoEn(precio, dia),
    };
  }
}

function cargaValida(comando: ProponerPrecio): CargaDePrecio {
  const referenciaId = uuid(comando.referenciaId, 'La referencia');
  const valor = pesos(comando.valor, 'El valor');
  const piso = pesos(comando.piso, 'El piso');
  const techo = pesos(comando.techo, 'El techo');
  if (centavos(piso) > centavos(techo)) {
    throw new BadRequestException('El piso no puede ser mayor que el techo.');
  }
  if (!(FUENTES as readonly string[]).includes(comando.fuente)) {
    throw new BadRequestException(`Fuente desconocida. Debe ser una de: ${FUENTES.join(', ')}.`);
  }
  const evidencia = comando.evidencia?.trim();
  if (!evidencia) {
    throw new BadRequestException('El precio necesita evidencia: de dónde sale el valor.');
  }
  const vigenteDesde = fechaValida(comando.vigenteDesde, 'El inicio de vigencia');
  const vigenteHasta =
    comando.vigenteHasta === null || comando.vigenteHasta === undefined
      ? null
      : fechaValida(comando.vigenteHasta, 'El fin de vigencia');
  if (vigenteHasta && vigenteHasta < vigenteDesde) {
    throw new BadRequestException('La vigencia no puede terminar antes de empezar.');
  }

  return {
    referenciaId,
    valor,
    piso,
    techo,
    fuente: comando.fuente,
    evidencia,
    vigenteDesde,
    vigenteHasta,
  };
}

function conEstado({ precio, repetida }: PrecioRegistrado): PrecioConRepeticion {
  return { precio: estadoEn(precio, hoyEnColombia()), repetida };
}

/** Un aprobado cuya vigencia terminó antes de la fecha está vencido. */
function estadoEn(precio: PrecioGuardado, fecha: string): Precio {
  const vencido =
    precio.estado === 'aprobado' && precio.vigenteHasta !== null && precio.vigenteHasta < fecha;
  return { ...precio, estado: vencido ? 'vencido' : precio.estado };
}

/** El piso y el techo cuentan como dentro de la banda. */
function fueraDeBanda({ valor, piso, techo }: PrecioGuardado): boolean {
  return centavos(valor) < centavos(piso) || centavos(valor) > centavos(techo);
}

/** En minúsculas, para que el hash no cambie por cómo lo escribió el cliente. */
function uuid(valor: string, sujeto: string): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) {
    throw new BadRequestException(`${sujeto} no es un UUID válido.`);
  }
  return valor.toLowerCase();
}

/** Pesos mayores que cero, sin ceros a la derecha: «2800» y no «2800.00». */
function pesos(valor: string | number, sujeto: string): string {
  const texto = String(valor).trim();
  if (!PESOS.test(texto) || centavos(texto) === 0n) {
    throw new BadRequestException(
      `${sujeto} debe ser mayor que cero, en pesos con punto decimal y hasta dos decimales.`,
    );
  }
  const digitos = centavos(texto).toString().padStart(3, '0');
  const decimales = digitos.slice(-2).replace(/0+$/, '');
  return decimales ? `${digitos.slice(0, -2)}.${decimales}` : digitos.slice(0, -2);
}

function centavos(texto: string): bigint {
  const [enteros = '0', decimales = ''] = texto.split('.');
  return BigInt(enteros + decimales.padEnd(2, '0'));
}

/** AAAA-MM-DD y una fecha que existe: el 30 de febrero no pasa. */
function fechaValida(fecha: string, sujeto: string): string {
  const instante =
    typeof fecha === 'string' && FECHA.test(fecha) ? Date.parse(`${fecha}T00:00Z`) : NaN;
  if (Number.isNaN(instante) || !new Date(instante).toISOString().startsWith(fecha)) {
    throw new BadRequestException(`${sujeto} no es una fecha válida (AAAA-MM-DD).`);
  }
  return fecha;
}

function sumarDias(fecha: string, dias: number): string {
  const dia = new Date(`${fecha}T00:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + dias);
  return dia.toISOString().slice(0, 10);
}

/** AAAA-MM-DD; en-CA es el formato de fecha que lo escribe así. */
function hoyEnColombia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_DEL_BANCO }).format(new Date());
}
