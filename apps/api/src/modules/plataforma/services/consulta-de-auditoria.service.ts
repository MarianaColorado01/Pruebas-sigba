import { BadRequestException, Injectable } from '@nestjs/common';
import type { PaginaDeAuditoria, RegistroDeAuditoria } from '@sigba/shared-types';
import {
  AuditoriaRepositorio,
  ExportacionDemasiadoGrande,
  type FiltroDeAuditoria,
  type PosicionEnAuditoria,
} from './auditoria.js';

const POR_PAGINA = 50;
const BOM = String.fromCharCode(0xfeff);
/** Tope de una exportación: evita armar en memoria un CSV que tumbe la API. */
const MAXIMO_EXPORTABLE = 50_000;

const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const COLUMNAS_CSV = [
  'ocurrido_en',
  'tipo_actor',
  'actor',
  'actor_id',
  'accion',
  'entidad',
  'entidad_id',
  'resultado',
  'finalidad',
  'cantidad',
];

export interface ConsultaDeAuditoria extends FiltroDeAuditoria {
  cursor?: string;
  limite?: number;
}

/**
 * El cursor es opaco para la PWA. Lleva el instante con microsegundos tal
 * como lo guarda PostgreSQL: un `Date` de JavaScript los recorta y la página
 * siguiente se saltaría los registros del mismo milisegundo.
 */
function escribirCursor({ ocurridoEn, id }: PosicionEnAuditoria): string {
  return Buffer.from(`${ocurridoEn}|${id}`).toString('base64url');
}

function leerCursor(cursor: string): PosicionEnAuditoria {
  const [ocurridoEn, id, ...resto] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (resto.length > 0 || !ocurridoEn || !id || !INSTANTE.test(ocurridoEn) || !UUID.test(id)) {
    throw new BadRequestException('El cursor de auditoría no es válido.');
  }
  return { ocurridoEn, id };
}

function exigirRango(desde: Date | undefined, hasta: Date | undefined): void {
  if (desde && hasta && desde >= hasta) {
    throw new BadRequestException('La fecha final debe ser posterior a la inicial.');
  }
}

/**
 * Una celda RFC 4180. Lo que empieza como fórmula se antepone con `'` para que
 * la hoja de cálculo no lo ejecute al abrir el archivo.
 */
function celda(valor: string | number | null | undefined): string {
  let texto = valor === null || valor === undefined ? '' : String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  return /[",\r\n]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

function filaCsv(r: RegistroDeAuditoria): string {
  return [
    r.ocurridoEn,
    r.tipoActor,
    r.actorNombre ?? r.actorEtiqueta ?? r.actorId,
    r.actorId,
    r.accion,
    r.entidad,
    r.entidadId,
    r.resultado,
    r.finalidad,
    r.detalle?.cantidad,
  ]
    .map(celda)
    .join(',');
}

/**
 * Consulta y exportación de la auditoría del banco (SBA-51, RF-M3-05). Solo
 * lee: la tabla es append-only y la escribe `AuditService` de `core`.
 */
@Injectable()
export class ConsultaDeAuditoriaService {
  constructor(private readonly repositorio: AuditoriaRepositorio) {}

  async consultar({ cursor, limite, ...filtro }: ConsultaDeAuditoria): Promise<PaginaDeAuditoria> {
    exigirRango(filtro.desde, filtro.hasta);
    const antesDe = cursor === undefined ? undefined : leerCursor(cursor);

    const { registros, hayMas } = await this.repositorio.listar(
      filtro,
      antesDe,
      limite ?? POR_PAGINA,
    );
    const ultimo = registros.at(-1);

    return { registros, siguienteCursor: hayMas && ultimo ? escribirCursor(ultimo) : null };
  }

  /**
   * CSV del periodo `[desde, hasta)` en UTF-8 con BOM, para que Excel no
   * rompa las tildes.
   */
  async exportarCsv(desde: Date, hasta: Date): Promise<string> {
    exigirRango(desde, hasta);

    let registros: RegistroDeAuditoria[];
    try {
      registros = await this.repositorio.exportar(desde, hasta, MAXIMO_EXPORTABLE);
    } catch (error) {
      if (error instanceof ExportacionDemasiadoGrande) {
        throw new BadRequestException(
          `El periodo tiene más de ${error.maximo} registros. Acorta el rango de fechas.`,
        );
      }
      throw error;
    }

    const lineas = [COLUMNAS_CSV.join(','), ...registros.map(filaCsv)];
    return `${BOM}${lineas.join('\r\n')}\r\n`;
  }
}
