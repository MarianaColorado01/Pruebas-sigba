import { createHash } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** La entidad que creó el comando. Es lo único que se guarda como resultado. */
export interface ResultadoDeComando {
  entidad: string;
  entidadId: string;
}

export interface ComandoAReclamar {
  comandoId: string;
  /**
   * JSON plano del comando validado, sin campos que calcule el servidor. Se usa
   * solo para el hash y no se guarda, pero el hash no lleva llave: no debe
   * incluir datos personales (Arquitectura 8.6).
   */
  carga: unknown;
  /** Lo que el comando va a crear si es nuevo. El id se genera antes de escribir. */
  resultado: ResultadoDeComando;
}

interface FilaReclamada extends ResultadoDeComando {
  nuevo: boolean;
  cargaHashVersion: number;
  cargaHash: string;
}

/** JSON con las claves de cada objeto ordenadas; los arreglos conservan su orden. */
function jsonCanonico(carga: unknown): string {
  return JSON.stringify(carga, (_clave, valor: unknown) =>
    valor && typeof valor === 'object' && !Array.isArray(valor)
      ? Object.fromEntries(Object.entries(valor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : valor,
  );
}

/**
 * Normalización de la carga por versión. Un comando guardado con la versión N
 * se compara con la regla N aunque después exista otra: si cambia la regla, se
 * agrega una versión y no se toca la anterior.
 */
const NORMALIZACIONES: Readonly<Record<number, (carga: unknown) => string>> = {
  1: jsonCanonico,
};
const VERSION_ACTUAL = 1;

function hashDeCarga(version: number, carga: unknown): string {
  const normalizar = NORMALIZACIONES[version];
  if (!normalizar) {
    throw new Error(`No hay normalización para la versión ${version} del hash de carga.`);
  }
  return createHash('sha256').update(normalizar(carga)).digest('hex');
}

/**
 * Idempotencia de las escrituras de negocio por `(banco_id, comando_id)`
 * (Arquitectura 6.1), sobre `core.comando_procesado`.
 *
 * Se llama al empezar la transacción de la escritura, con el mismo `tx`: si
 * la escritura revierte, la reserva también. El banco no se pasa:
 * `core.reclamar_comando` lo lee del contexto que fijó
 * `executeTransactionWithTenant`.
 */
@Injectable()
export class IdempotenciaService {
  /**
   * Devuelve `null` si el comando es nuevo: queda reservado y el llamador
   * escribe. Si ya se procesó con la misma carga, devuelve su resultado
   * original y el llamador no escribe nada. Con otra carga, 409.
   */
  async reclamar(
    tx: Prisma.TransactionClient,
    { comandoId, carga, resultado }: ComandoAReclamar,
  ): Promise<ResultadoDeComando | null> {
    const [fila] = await tx.$queryRaw<FilaReclamada[]>`
      SELECT nuevo,
             carga_hash_version AS "cargaHashVersion",
             carga_hash AS "cargaHash",
             entidad,
             entidad_id::text AS "entidadId"
      FROM core.reclamar_comando(
        ${comandoId}::uuid,
        ${VERSION_ACTUAL}::smallint,
        ${hashDeCarga(VERSION_ACTUAL, carga)}::text,
        ${resultado.entidad}::text,
        ${resultado.entidadId}::uuid
      )
    `;
    if (!fila) throw new Error('core.reclamar_comando no devolvió la fila del comando.');
    if (fila.nuevo) return null;

    if (
      fila.entidad !== resultado.entidad ||
      fila.cargaHash !== hashDeCarga(fila.cargaHashVersion, carga)
    ) {
      throw new ConflictException('Este comando ya se procesó con otra carga.');
    }
    return { entidad: fila.entidad, entidadId: fila.entidadId };
  }
}
