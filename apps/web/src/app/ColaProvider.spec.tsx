import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCola, type Cola } from '@/offline/cola.ts';
import { colaDb } from '@/offline/colaDb.ts';
import { uuidv7 } from '@/offline/uuidv7.ts';
import { SesionContext } from '@/shared/sesion.ts';
import { ColaProvider } from './ColaProvider.tsx';

const USUARIO = 'auth0|operario-sintetico';
const getAccessTokenSilently = vi.fn<() => Promise<string>>();

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ user: { sub: USUARIO }, getAccessTokenSilently }),
}));

const CARGA = {
  donanteId: 'donante-sintetico',
  origen: 'donacion',
  bodegaId: 'bodega-sintetica',
  detalles: [
    { movimientoId: 'movimiento-sintetico', referenciaId: 'referencia-arroz', cantidad: '12' },
  ],
};

function respuesta(estado: number, cuerpo: unknown = {}) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Monta la cola en un banco nuevo y entrega lo que ve una pantalla. */
function montar() {
  const bancoId = uuidv7();
  const cola: { actual?: Cola } = {};
  function Consumidor() {
    cola.actual = useCola();
    return (
      <ul>
        {cola.actual.comandos.map((comando) => (
          <li key={comando.comandoId}>{comando.estado}</li>
        ))}
      </ul>
    );
  }
  render(
    <SesionContext value={{ rol: 'operario_bodega', bancoId, institucionId: null }}>
      <ColaProvider>
        <Consumidor />
      </ColaProvider>
    </SesionContext>,
  );
  return { bancoId, cola: () => cola.actual! };
}

afterEach(() => {
  vi.unstubAllGlobals();
  getAccessTokenSilently.mockReset();
});

describe('ColaProvider', () => {
  it('guarda la recepción, la envía con su comandoId y la marca confirmada', async () => {
    getAccessTokenSilently.mockResolvedValue('synthetic-access-token');
    const fetch = vi.fn().mockResolvedValue(respuesta(201, { id: 'recepcion-sintetica' }));
    vi.stubGlobal('fetch', fetch);
    const { bancoId, cola } = montar();

    let comandoId = '';
    await act(async () => {
      ({ comandoId } = await cola().encolar('recepcion', CARGA));
    });

    await waitFor(() => expect(screen.getByText('confirmado')).toBeInTheDocument());
    const [url, opciones] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/recepciones$/);
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body as string)).toEqual({ ...CARGA, comandoId });
    expect(new Headers(opciones.headers).get('x-banco-id')).toBe(bancoId);
    // El token viaja en la cabecera y nunca se guarda con el comando (ADR-06).
    expect(JSON.stringify(await colaDb.listar(bancoId, USUARIO))).not.toContain(
      'synthetic-access-token',
    );
  });

  it('usa el comandoId de quien llama y no duplica un comando que ya está en la cola', async () => {
    getAccessTokenSilently.mockResolvedValue('synthetic-access-token');
    // Sin red: el primer envío falla y el comando sigue en la cola cuando se reintenta.
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const { bancoId, cola } = montar();
    const comandoId = uuidv7();

    let primero, segundo;
    await act(async () => {
      primero = await cola().encolar('recepcion', CARGA, comandoId);
      segundo = await cola().encolar('recepcion', { ...CARGA, origen: 'compra' }, comandoId);
    });

    expect(primero).toMatchObject({ comandoId, carga: CARGA });
    // Devuelve el guardado, con su carga original: la API compara el hash de esa.
    expect(segundo).toMatchObject({ comandoId, carga: CARGA });
    const guardados = await colaDb.listar(bancoId, USUARIO);
    expect(guardados).toHaveLength(1);
    expect(guardados[0]?.carga).toEqual(CARGA);
  });

  it('sin red queda pendiente de sincronizar y sale al volver la red', async () => {
    getAccessTokenSilently.mockResolvedValue('synthetic-access-token');
    const fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetch);
    const { cola } = montar();

    await act(async () => {
      for (let i = 0; i < 5; i++) await cola().encolar('recepcion', CARGA);
    });
    await waitFor(() => expect(screen.getAllByText('pendiente')).toHaveLength(5));

    fetch.mockImplementation(() => Promise.resolve(respuesta(201)));
    const inicio = Date.now();
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    // RNF-M1-05: al reconectar no espera el reintento programado.
    await waitFor(() => expect(screen.getAllByText('confirmado')).toHaveLength(5));
    expect(Date.now() - inicio).toBeLessThan(30_000);
  });

  it('un comando nuevo no se salta la espera del reintento de la cabeza de la cola', async () => {
    getAccessTokenSilently.mockResolvedValue('synthetic-access-token');
    const fetch = vi.fn().mockResolvedValue(respuesta(503, { message: 'Servicio no disponible' }));
    vi.stubGlobal('fetch', fetch);
    const { bancoId, cola } = montar();

    await act(async () => {
      await cola().encolar('recepcion', CARGA);
    });
    await waitFor(async () => expect((await colaDb.listar(bancoId, USUARIO))[0]?.intentos).toBe(1));
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await cola().encolar('recepcion', CARGA);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('pendiente')).toHaveLength(2);
  });

  it('al abrir borra los confirmados de más de 7 días', async () => {
    getAccessTokenSilently.mockResolvedValue('synthetic-access-token');
    vi.stubGlobal('fetch', vi.fn());
    const bancoId = uuidv7();
    const viejo = '2026-01-01T00:00:00.000Z';
    await colaDb.agregar({
      comandoId: uuidv7(),
      bancoId,
      usuario: USUARIO,
      tipo: 'recepcion',
      carga: CARGA,
      estado: 'confirmado',
      creadoEn: viejo,
      intentos: 0,
      proximoIntento: 0,
    });

    render(
      <SesionContext value={{ rol: 'operario_bodega', bancoId, institucionId: null }}>
        <ColaProvider>{null}</ColaProvider>
      </SesionContext>,
    );

    await waitFor(async () => expect(await colaDb.listar(bancoId, USUARIO)).toEqual([]));
  });

  it('con la sesión vencida no pierde nada: espera a que la persona vuelva a entrar', async () => {
    getAccessTokenSilently.mockRejectedValue({ error: 'login_required' });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { bancoId, cola } = montar();

    await act(async () => {
      await cola().encolar('recepcion', CARGA);
    });

    await waitFor(() => expect(getAccessTokenSilently).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('pendiente')).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
    expect((await colaDb.listar(bancoId, USUARIO))[0]?.intentos).toBe(0);
  });

  it('un 409 deja el comando en conflicto con el motivo de la API', async () => {
    getAccessTokenSilently.mockResolvedValue('synthetic-access-token');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respuesta(409, { message: 'Ese comando ya llegó con otra carga.', codigo: 'otra_carga' }),
        ),
    );
    const { bancoId, cola } = montar();

    await act(async () => {
      await cola().encolar('recepcion', CARGA);
    });

    await waitFor(() => expect(screen.getByText('conflicto')).toBeInTheDocument());
    const [comando] = await colaDb.listar(bancoId, USUARIO);
    expect(comando?.rechazo).toEqual({
      estado: 409,
      codigo: 'otra_carga',
      mensaje: 'Ese comando ya llegó con otra carga.',
    });
  });
});
