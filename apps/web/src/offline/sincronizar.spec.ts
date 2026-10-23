import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { colaDb, type ComandoEnCola } from './colaDb.ts';
import { crearSincronizador, esperaTras, sincronizar, type Enviar } from './sincronizar.ts';
import { uuidv7 } from './uuidv7.ts';

const USUARIO = 'auth0|operario-sintetico';
const AHORA = Date.parse('2026-10-21T15:00:00Z');

/** Cada prueba usa su propio banco: la base simulada se comparte en el archivo. */
async function encolar(
  bancoId: string,
  cuantos: number,
  datos: Partial<ComandoEnCola> = {},
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < cuantos; i++) {
    const comandoId = uuidv7(AHORA + i);
    await colaDb.agregar({
      comandoId,
      bancoId,
      usuario: USUARIO,
      tipo: 'recepcion',
      carga: { bodegaId: 'bodega-sintetica', detalles: [{ cantidad: String(i + 1) }] },
      estado: 'pendiente',
      creadoEn: new Date(AHORA).toISOString(),
      intentos: 0,
      proximoIntento: 0,
      ...datos,
    });
    ids.push(comandoId);
  }
  return ids;
}

const estados = async (bancoId: string) =>
  (await colaDb.listar(bancoId, USUARIO)).map((comando) => comando.estado);

function correr(
  bancoId: string,
  enviar: Enviar,
  opciones: { forzar?: boolean; ahora?: number } = {},
) {
  return sincronizar({
    bancoId,
    usuario: USUARIO,
    enviar,
    forzar: opciones.forzar,
    ahora: () => opciones.ahora ?? AHORA,
  });
}

describe('sincronizar', () => {
  it('envía los pendientes en el orden en que se crearon y los confirma', async () => {
    const banco = uuidv7();
    const ids = await encolar(banco, 5);
    const enviados: string[] = [];

    const resultado = await correr(banco, (comando) => {
      enviados.push(comando.comandoId);
      return Promise.resolve({});
    });

    expect(resultado).toEqual({ tipo: 'al-dia' });
    expect(enviados).toEqual(ids);
    expect(await estados(banco)).toEqual(Array(5).fill('confirmado'));
  });

  it('marca el comando como enviado mientras espera la respuesta de la API', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);
    let estadoDuranteElEnvio: string | undefined;

    await correr(banco, async () => {
      estadoDuranteElEnvio = (await colaDb.listar(banco, USUARIO))[0]?.estado;
    });

    expect(estadoDuranteElEnvio).toBe('enviado');
  });

  it('reenvía un comando que quedó enviado cuando se cerró la app', async () => {
    const banco = uuidv7();
    await encolar(banco, 1, { estado: 'enviado' });
    const enviar = vi.fn().mockResolvedValue({});

    await correr(banco, enviar);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await estados(banco)).toEqual(['confirmado']);
  });

  it('no reenvía lo confirmado ni lo que está en conflicto', async () => {
    const banco = uuidv7();
    await encolar(banco, 1, { estado: 'confirmado' });
    await encolar(banco, 1, { estado: 'conflicto' });
    const enviar = vi.fn();

    await correr(banco, enviar);

    expect(enviar).not.toHaveBeenCalled();
  });

  it('sin red deja el comando pendiente, cuenta el intento y no envía los siguientes', async () => {
    const banco = uuidv7();
    await encolar(banco, 3);
    const enviar = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const resultado = await correr(banco, enviar);

    expect(resultado).toEqual({ tipo: 'reintentar', en: AHORA + esperaTras(1) });
    expect(enviar).toHaveBeenCalledTimes(1);
    const [primero] = await colaDb.listar(banco, USUARIO);
    expect(primero).toMatchObject({ estado: 'pendiente', intentos: 1 });
    expect(await estados(banco)).toEqual(['pendiente', 'pendiente', 'pendiente']);
  });

  it('trata un 5xx como pasajero', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);

    const resultado = await correr(banco, () =>
      Promise.reject(new ErrorDeApi(503, 'Servicio no disponible')),
    );

    expect(resultado.tipo).toBe('reintentar');
    expect(await estados(banco)).toEqual(['pendiente']);
  });

  it('espera el tiempo del reintento salvo que se fuerce, como al volver la red', async () => {
    const banco = uuidv7();
    await encolar(banco, 5, { intentos: 4, proximoIntento: AHORA + 30_000 });
    const enviar = vi.fn().mockResolvedValue({});

    expect(await correr(banco, enviar)).toEqual({ tipo: 'reintentar', en: AHORA + 30_000 });
    expect(enviar).not.toHaveBeenCalled();

    expect(await correr(banco, enviar, { forzar: true })).toEqual({ tipo: 'al-dia' });
    expect(enviar).toHaveBeenCalledTimes(5);
  });

  it('crece la espera entre intentos hasta un minuto', () => {
    expect([1, 2, 3, 6, 20].map(esperaTras)).toEqual([2000, 4000, 8000, 60_000, 60_000]);
  });

  it('deja en conflicto lo que la API rechaza, con el motivo, y sigue con los demás', async () => {
    const banco = uuidv7();
    const [rechazado] = await encolar(banco, 2);
    const enviar: Enviar = (comando) =>
      comando.comandoId === rechazado
        ? Promise.reject(
            new ErrorDeApi(409, 'Ese comando ya llegó con otra carga.', 'comando_repetido'),
          )
        : Promise.resolve({});

    expect(await correr(banco, enviar)).toEqual({ tipo: 'al-dia' });

    const [primero, segundo] = await colaDb.listar(banco, USUARIO);
    expect(primero).toMatchObject({
      estado: 'conflicto',
      rechazo: {
        estado: 409,
        codigo: 'comando_repetido',
        mensaje: 'Ese comando ya llegó con otra carga.',
      },
    });
    expect(segundo?.estado).toBe('confirmado');
  });

  it('un rechazo por regla de negocio también queda en conflicto y no se borra', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);

    await correr(banco, () => Promise.reject(new ErrorDeApi(422, 'No hay stock en ese lote.')));
    await correr(banco, vi.fn());

    expect(await estados(banco)).toEqual(['conflicto']);
  });

  it('un 404 de la API es rechazo y no detiene la cola', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);
    await correr(banco, () =>
      Promise.reject(new ErrorDeApi(404, 'Fila 1: no existe esa referencia o está desactivada.')),
    );
    expect(await estados(banco)).toEqual(['conflicto']);
  });

  it('un 403 deja el comando en conflicto con un aviso de permiso y la cola sigue', async () => {
    const banco = uuidv7();
    const [sinPermiso] = await encolar(banco, 3);
    const enviar: Enviar = (comando) =>
      comando.comandoId === sinPermiso
        ? Promise.reject(new ErrorDeApi(403, 'Forbidden'))
        : Promise.resolve({});

    expect(await correr(banco, enviar)).toEqual({ tipo: 'al-dia' });

    const [primero] = await colaDb.listar(banco, USUARIO);
    expect(await estados(banco)).toEqual(['conflicto', 'confirmado', 'confirmado']);
    expect(primero?.rechazo).toEqual({
      estado: 403,
      mensaje: 'No tienes permiso para registrar esto en este banco.',
    });
  });

  it('deja de enviar cuando le dicen que pare, sin tocar lo que falta', async () => {
    const banco = uuidv7();
    await encolar(banco, 3);
    let enviados = 0;

    await sincronizar({
      bancoId: banco,
      usuario: USUARIO,
      enviar: () => Promise.resolve(enviados++),
      seguir: () => enviados < 1,
    });

    expect(await estados(banco)).toEqual(['confirmado', 'pendiente', 'pendiente']);
  });

  it('con la sesión vencida se detiene sin contar el intento y retoma después', async () => {
    const banco = uuidv7();
    await encolar(banco, 2);

    const vencida = await correr(banco, () => Promise.reject(new ErrorDeApi(401, 'Unauthorized')));
    expect(vencida).toEqual({ tipo: 'sin-sesion' });
    expect(await colaDb.listar(banco, USUARIO)).toMatchObject([
      { estado: 'pendiente', intentos: 0 },
      { estado: 'pendiente', intentos: 0 },
    ]);

    const auth0 = await correr(banco, () => Promise.reject({ error: 'login_required' }));
    expect(auth0).toEqual({ tipo: 'sin-sesion' });

    expect(await correr(banco, vi.fn().mockResolvedValue({}))).toEqual({ tipo: 'al-dia' });
    expect(await estados(banco)).toEqual(['confirmado', 'confirmado']);
  });

  it('solo envía los comandos de esa persona en ese banco', async () => {
    const banco = uuidv7();
    const otroBanco = uuidv7();
    await encolar(banco, 1);
    await encolar(otroBanco, 1);
    await colaDb.agregar({
      ...(await colaDb.listar(banco, USUARIO))[0]!,
      comandoId: uuidv7(),
      usuario: 'auth0|otra-persona',
    });
    const enviar = vi.fn().mockResolvedValue({});

    await correr(banco, enviar);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(await estados(otroBanco)).toEqual(['pendiente']);
  });
});

describe('crearSincronizador', () => {
  it('junta en una vuelta más lo que llega mientras otra está en curso', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);
    let soltar!: () => void;
    const enviar = vi
      .fn<Enviar>()
      .mockImplementationOnce(() => new Promise<void>((resolver) => (soltar = resolver)))
      .mockResolvedValue({});
    const sincronizador = crearSincronizador({ bancoId: banco, usuario: USUARIO, enviar });

    const primera = sincronizador.disparar();
    await vi.waitFor(() => expect(enviar).toHaveBeenCalledTimes(1));
    await encolar(banco, 1);
    void sincronizador.disparar(true);
    void sincronizador.disparar(true);
    soltar();
    await primera;

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(await estados(banco)).toEqual(['confirmado', 'confirmado']);
  });

  it('reintenta solo a la hora que pidió la vuelta fallida', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);
    const enviar = vi
      .fn<Enviar>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({});
    const sincronizador = crearSincronizador({ bancoId: banco, usuario: USUARIO, enviar });

    await sincronizador.disparar();
    expect(await estados(banco)).toEqual(['pendiente']);

    // Temporizadores reales: el primer reintento llega a los dos segundos.
    await vi.waitFor(async () => expect(await estados(banco)).toEqual(['confirmado']), {
      timeout: esperaTras(1) + 2000,
    });
    expect(enviar).toHaveBeenCalledTimes(2);
    sincronizador.detener();
  });

  it('detenido no programa más intentos', async () => {
    const banco = uuidv7();
    await encolar(banco, 1);
    const enviar = vi.fn<Enviar>().mockRejectedValue(new TypeError('Failed to fetch'));
    const sincronizador = crearSincronizador({ bancoId: banco, usuario: USUARIO, enviar });

    sincronizador.detener();
    await sincronizador.disparar();

    expect(enviar).not.toHaveBeenCalled();
  });
});
