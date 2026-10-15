import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { IdempotenciaService } from './idempotencia.service.js';

const COMANDO = '0192f0e0-0000-7000-8000-000000000001';
const RECEPCION = '33333333-3333-3333-3333-333333333333';
const OTRA_RECEPCION = '44444444-4444-4444-4444-444444444444';

const carga = { donanteId: 'd1', detalles: [{ referenciaId: 'r1', cantidad: '2' }] };
const hashDe = (texto: string) => createHash('sha256').update(texto).digest('hex');
const HASH_V1 = hashDe('{"detalles":[{"cantidad":"2","referenciaId":"r1"}],"donanteId":"d1"}');

function txQueDevuelve(fila: object | undefined) {
  return { $queryRaw: vi.fn().mockResolvedValue(fila ? [fila] : []) };
}

function previa(cambios: object = {}) {
  return {
    nuevo: false,
    cargaHashVersion: 1,
    cargaHash: HASH_V1,
    entidad: 'recepcion',
    entidadId: RECEPCION,
    ...cambios,
  };
}

const reclamar = (tx: object, cargaEnviada: unknown = carga) =>
  new IdempotenciaService().reclamar(tx as never, {
    comandoId: COMANDO,
    carga: cargaEnviada,
    resultado: { entidad: 'recepcion', entidadId: OTRA_RECEPCION },
  });

describe('IdempotenciaService', () => {
  it('un comando nuevo queda reservado con el hash v1 y devuelve null', async () => {
    const tx = txQueDevuelve({ ...previa(), nuevo: true, entidadId: OTRA_RECEPCION });

    await expect(reclamar(tx)).resolves.toBeNull();

    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(tx.$queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([COMANDO, 1, HASH_V1, 'recepcion', OTRA_RECEPCION]),
    );
  });

  it('el hash no depende del orden de las claves', async () => {
    const tx = txQueDevuelve({ ...previa(), nuevo: true });

    await reclamar(tx, { detalles: [{ cantidad: '2', referenciaId: 'r1' }], donanteId: 'd1' });

    expect(tx.$queryRaw.mock.calls[0]).toContain(HASH_V1);
  });

  it('el mismo comando con la misma carga devuelve el resultado guardado, no el nuevo', async () => {
    await expect(reclamar(txQueDevuelve(previa()))).resolves.toEqual({
      entidad: 'recepcion',
      entidadId: RECEPCION,
    });
  });

  it('el mismo comando con otra carga responde 409', async () => {
    const tx = txQueDevuelve(previa());

    await expect(reclamar(tx, { ...carga, donanteId: 'd2' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('el mismo comando_id usado para otra entidad responde 409', async () => {
    await expect(reclamar(txQueDevuelve(previa({ entidad: 'salida' })))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('una versión de hash que este código no conoce no se compara', async () => {
    await expect(reclamar(txQueDevuelve(previa({ cargaHashVersion: 99 })))).rejects.toThrow(
      /versión 99/,
    );
  });

  it('falla si la función no devuelve fila', async () => {
    await expect(reclamar(txQueDevuelve(undefined))).rejects.toThrow(/no devolvió/);
  });

  describe('consultar', () => {
    const consultar = (tx: object, cargaEnviada: unknown = carga) =>
      new IdempotenciaService().consultar(tx as never, {
        comandoId: COMANDO,
        carga: cargaEnviada,
        entidad: 'recepcion',
      });

    it('sin fila devuelve null y no reserva nada', async () => {
      const tx = txQueDevuelve(undefined);

      await expect(consultar(tx)).resolves.toBeNull();
      expect(String(tx.$queryRaw.mock.calls[0]?.[0])).not.toMatch(/reclamar_comando/);
    });

    it('con la misma carga devuelve el resultado guardado', async () => {
      await expect(consultar(txQueDevuelve(previa()))).resolves.toEqual({
        entidad: 'recepcion',
        entidadId: RECEPCION,
      });
    });

    it('con otra carga responde 409', async () => {
      await expect(
        consultar(txQueDevuelve(previa()), { ...carga, donanteId: 'd2' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
