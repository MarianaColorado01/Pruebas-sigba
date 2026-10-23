import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { colaDb, type ComandoEnCola } from './colaDb.ts';
import { uuidv7 } from './uuidv7.ts';

const USUARIO = 'auth0|operario-sintetico';
const AHORA = Date.parse('2026-10-22T15:00:00Z');
const DIA_MS = 24 * 60 * 60 * 1000;

function comando(datos: Partial<ComandoEnCola> = {}): ComandoEnCola {
  return {
    comandoId: uuidv7(),
    bancoId: uuidv7(),
    usuario: USUARIO,
    tipo: 'recepcion',
    carga: { bodegaId: 'bodega-sintetica' },
    estado: 'pendiente',
    creadoEn: new Date(AHORA).toISOString(),
    intentos: 0,
    proximoIntento: 0,
    ...datos,
  };
}

describe('colaDb.agregarSiNoExiste', () => {
  it('con el mismo banco y persona devuelve el comando guardado', async () => {
    const original = comando();

    await colaDb.agregarSiNoExiste(original);
    const repetido = await colaDb.agregarSiNoExiste({ ...original, carga: { otra: 'carga' } });

    expect(repetido).toEqual(original);
    expect(await colaDb.listar(original.bancoId, USUARIO)).toEqual([original]);
  });

  it.each([
    ['otro banco', { bancoId: uuidv7() }],
    ['otra persona', { usuario: 'auth0|otra-persona' }],
  ])('con el comandoId de %s falla y no devuelve el registro ajeno', async (_, ajeno) => {
    const original = comando({ carga: { donanteId: 'donante-sintetico' } });
    await colaDb.agregarSiNoExiste(original);
    const intruso = { ...original, ...ajeno };

    const error = await colaDb.agregarSiNoExiste(intruso).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/comandoId/);
    expect(JSON.stringify(error)).not.toContain('donante-sintetico');
    expect(await colaDb.listar(original.bancoId, USUARIO)).toEqual([original]);
    expect(await colaDb.listar(intruso.bancoId, intruso.usuario)).toEqual([]);
  });
});

describe('colaDb.purgarConfirmados', () => {
  it('borra los confirmados de más de 7 días y deja todo lo demás', async () => {
    const bancoId = uuidv7();
    const hace = (dias: number) => new Date(AHORA - dias * DIA_MS).toISOString();
    const viejoConfirmado = comando({ bancoId, estado: 'confirmado', creadoEn: hace(8) });
    const recienteConfirmado = comando({ bancoId, estado: 'confirmado', creadoEn: hace(6) });
    const viejoPendiente = comando({ bancoId, estado: 'pendiente', creadoEn: hace(30) });
    const viejoEnConflicto = comando({ bancoId, estado: 'conflicto', creadoEn: hace(30) });
    const viejoEnviado = comando({ bancoId, estado: 'enviado', creadoEn: hace(30) });
    for (const guardado of [
      viejoConfirmado,
      recienteConfirmado,
      viejoPendiente,
      viejoEnConflicto,
      viejoEnviado,
    ]) {
      await colaDb.agregar(guardado);
    }

    await colaDb.purgarConfirmados(AHORA);

    const quedan = (await colaDb.listar(bancoId, USUARIO)).map((c) => c.comandoId);
    expect(quedan).toHaveLength(4);
    expect(quedan).not.toContain(viejoConfirmado.comandoId);
  });
});
