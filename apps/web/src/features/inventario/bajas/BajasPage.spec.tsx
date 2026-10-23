import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stockDb } from '@/offline/stockDb.ts';
import { MENSAJE_DE_CANTIDAD, MENSAJE_DE_CIFRAS } from '@/shared/cantidad.ts';
import { SesionContext } from '@/shared/sesion.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { BajasPage } from './BajasPage.tsx';
import type { ComandoSobreUnLote } from './registrarMovimiento.ts';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

vi.mock('@/offline/stockDb.ts', () => ({
  stockDb: { leer: vi.fn(), guardar: vi.fn() },
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
const BODEGA = { id: 'bodega-1', nombre: 'Bodega principal', direccion: null, activa: true };

const LOTE: LoteEnStock = {
  bodegaId: 'bodega-1',
  loteId: 'lote-1',
  codigo: 'L-7',
  vencimiento: '2027-03-01',
  estado: 'vigente',
  diasParaVencer: 130,
  semaforo: null,
  cantidad: '10',
  kilos: '10',
  referencia: {
    id: 'referencia-1',
    presentacion: '1 kg',
    producto: { id: 'producto-1', nombre: 'Arroz' },
    categoria: { id: 'categoria-1', codigo: 'C801', nombre: 'Arroz' },
  },
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Responde stock y bodegas; `movimiento` decide qué pasa con el POST y `lotes`, el saldo. */
function api(
  movimiento: (ruta: string, comando: ComandoSobreUnLote) => Promise<Response>,
  lotes: () => LoteEnStock[] = () => [LOTE],
) {
  return vi.fn(async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const ruta = String(entrada);
    if (ruta.endsWith('/stock')) return json(lotes());
    if (ruta.endsWith('/bodegas')) return json([BODEGA]);
    if (ruta.endsWith('/bajas') || ruta.endsWith('/ajustes')) {
      return movimiento(ruta, JSON.parse(String(opciones?.body)) as ComandoSobreUnLote);
    }
    throw new Error(`ruta inesperada: ${ruta}`);
  });
}

function registrado(ruta: string, comando: ComandoSobreUnLote) {
  const baja = ruta.endsWith('/bajas');
  const cantidad = baja ? `-${comando.cantidad}` : comando.cantidad;
  return json(
    {
      ...comando,
      tipo: baja ? 'baja' : 'ajuste',
      cantidad,
      kilos: cantidad,
      registradoEn: '2026-10-21T15:00:00.000Z',
    },
    201,
  );
}

function enviados(fetchMock: ReturnType<typeof api>) {
  return fetchMock.mock.calls
    .filter(([ruta]) => /\/(bajas|ajustes)$/.test(String(ruta)))
    .map(([ruta, opciones]) => ({
      ruta: String(ruta),
      comando: JSON.parse(String(opciones?.body)) as ComandoSobreUnLote,
    }));
}

function montar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>
      <SesionContext.Provider value={{ rol: 'coordinacion', bancoId: BANCO, institucionId: null }}>
        {children}
      </SesionContext.Provider>
    </QueryClientProvider>
  );
  render(<BajasPage />, { wrapper });
}

async function elegirLote() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar lote' }), {
    target: { value: 'arroz' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: /Arroz 1 kg.*Lote L-7.*Bodega principal/ }),
  );
}

describe('pantalla de bajas y ajustes', () => {
  beforeEach(() => {
    vi.mocked(stockDb.leer).mockResolvedValue(undefined);
    vi.mocked(stockDb.guardar).mockResolvedValue(BANCO);
  });

  it('registra una baja con motivo sobre el lote elegido', async () => {
    const fetchMock = api(async (ruta, comando) => registrado(ruta, comando));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '2,5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'No apto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

    await screen.findByRole('heading', { name: 'Baja registrada' });
    const [envio] = enviados(fetchMock);
    expect(envio?.ruta).toMatch(/\/bajas$/);
    expect(envio?.comando).toMatchObject({
      bodegaId: 'bodega-1',
      referenciaId: 'referencia-1',
      loteId: 'lote-1',
      cantidad: '2.5',
      motivo: 'no_apto',
    });
  });

  it('un ajuste por faltante va con signo negativo y motivo escrito', async () => {
    const fetchMock = api(async (ruta, comando) => registrado(ruta, comando));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Ajuste' }));
    await elegirLote();
    fireEvent.click(screen.getByRole('button', { name: 'Falta producto' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades de diferencia' }), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo' }), {
      target: { value: 'Conteo de fin de mes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));

    await screen.findByRole('heading', { name: 'Ajuste registrado' });
    const [envio] = enviados(fetchMock);
    expect(envio?.ruta).toMatch(/\/ajustes$/);
    expect(envio?.comando).toMatchObject({ cantidad: '-3', motivo: 'Conteo de fin de mes' });
  });

  it('no deja registrar un ajuste sin motivo', async () => {
    const fetchMock = api(async (ruta, comando) => registrado(ruta, comando));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Ajuste' }));
    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades de diferencia' }), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar ajuste' }));

    await screen.findByText('Escribe el motivo del ajuste.');
    expect(enviados(fetchMock)).toEqual([]);
  });

  it('muestra el rechazo por saldo insuficiente y no cambia nada', async () => {
    const fetchMock = api(async () =>
      json({ message: 'No hay saldo suficiente en ese lote y bodega.' }, 409),
    );
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Vencido' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

    await screen.findByText('No hay saldo suficiente en ese lote y bodega.');
    expect(screen.queryByRole('heading', { name: 'Baja registrada' })).toBeNull();
  });

  it('sin señal reintenta con el mismo comando', async () => {
    let intentos = 0;
    const fetchMock = api(async (ruta, comando) => {
      intentos += 1;
      if (intentos === 1) throw new TypeError('Network error');
      return registrado(ruta, comando);
    });
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));
    await screen.findByText(/Sin señal · no se registró todavía/);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await screen.findByRole('heading', { name: 'Baja registrada' });
    await waitFor(() => expect(enviados(fetchMock)).toHaveLength(2));
    const [primero, segundo] = enviados(fetchMock);
    expect(segundo?.comando).toEqual(primero?.comando);
  });

  it('rechaza «4.200» y no envía nada', async () => {
    const fetchMock = api(async (ruta, comando) => registrado(ruta, comando));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '4.200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
    expect(screen.getAllByText(MENSAJE_DE_CANTIDAD)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

    await screen.findByText('Revisa la cantidad.');
    expect(enviados(fetchMock)).toEqual([]);
  });

  it('rechaza más de tres decimales sin redondear y no envía nada', async () => {
    const fetchMock = api(async (ruta, comando) => registrado(ruta, comando));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '0,3333' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
    expect(screen.getByText(MENSAJE_DE_CIFRAS)).toBeTruthy();
    expect(screen.queryByText(/Se registrará/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

    await screen.findByText('Revisa la cantidad.');
    expect(enviados(fetchMock)).toEqual([]);
  });

  it('muestra la cantidad leída y envía 4200 como 4200', async () => {
    const fetchMock = api(async (ruta, comando) => registrado(ruta, comando));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '4200' },
    });
    expect(screen.getByText(/Se registrará: 4\.?200$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

    await screen.findByRole('heading', { name: 'Baja registrada' });
    expect(enviados(fetchMock)[0]?.comando.cantidad).toBe('4200');
  });

  describe('reenvío tras perder la respuesta', () => {
    async function conRespuestaPerdida() {
      let intentos = 0;
      const fetchMock = api(async (ruta, comando) => {
        intentos += 1;
        if (intentos === 1) throw new TypeError('Network error');
        return registrado(ruta, comando);
      });
      vi.stubGlobal('fetch', fetchMock);
      montar();
      await elegirLote();
      fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
        target: { value: '1' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
      fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));
      await screen.findByText(/Sin señal · no se registró todavía/);
      return fetchMock;
    }

    it('volver a elegir el mismo motivo o el mismo lote conserva el comandoId', async () => {
      const fetchMock = await conRespuestaPerdida();

      fireEvent.click(screen.getByRole('button', { name: 'Vencido' }));
      fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cambiar' }));
      await elegirLote();
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

      await screen.findByRole('heading', { name: 'Baja registrada' });
      await waitFor(() => expect(enviados(fetchMock)).toHaveLength(2));
      const [primero, segundo] = enviados(fetchMock);
      expect(segundo?.comando).toEqual(primero?.comando);
    });

    it('reescribir la misma cantidad con otros ceros conserva el comandoId', async () => {
      const fetchMock = await conRespuestaPerdida();

      fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
        target: { value: '01,00' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

      await screen.findByRole('heading', { name: 'Baja registrada' });
      const [primero, segundo] = enviados(fetchMock);
      expect(segundo?.comando).toEqual(primero?.comando);
    });

    it('cambiar lo que se registra estrena comando', async () => {
      const fetchMock = await conRespuestaPerdida();

      fireEvent.click(screen.getByRole('button', { name: 'Vencido' }));
      fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

      await screen.findByRole('heading', { name: 'Baja registrada' });
      const [primero, segundo] = enviados(fetchMock);
      expect(segundo?.comando.comandoId).not.toBe(primero?.comando.comandoId);
      expect(segundo?.comando.motivo).toBe('vencido');
    });
  });

  it('bloquea el formulario mientras se envía y el éxito muestra el lote registrado', async () => {
    let responder: (respuesta: Response) => void = () => undefined;
    const fetchMock = api(
      () =>
        new Promise<Response>((resolver) => {
          responder = resolver;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await elegirLote();
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Roto' }));
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));
    await screen.findByRole('button', { name: 'Enviando…' });

    const cambiar = screen.getByRole('button', { name: 'Cambiar' });
    expect(cambiar.matches(':disabled')).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Unidades que salen' }).matches(':disabled')).toBe(
      true,
    );
    fireEvent.click(cambiar);

    const [envio] = enviados(fetchMock);
    responder(registrado(envio?.ruta ?? '', envio?.comando as ComandoSobreUnLote));
    await screen.findByRole('heading', { name: 'Baja registrada' });
    expect(screen.getByText(/Arroz 1 kg · Lote L-7/)).toBeTruthy();
  });

  it('tras un 409 por saldo insuficiente muestra el saldo recargado', async () => {
    let saldo = '10';
    const fetchMock = api(
      async () => {
        saldo = '3';
        return json({ message: 'No hay saldo suficiente en ese lote y bodega.' }, 409);
      },
      () => [{ ...LOTE, cantidad: saldo }],
    );
    vi.stubGlobal('fetch', fetchMock);
    montar();
    const consultasDeStock = () =>
      fetchMock.mock.calls.filter(([ruta]) => String(ruta).endsWith('/stock')).length;

    await elegirLote();
    expect(consultasDeStock()).toBe(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Unidades que salen' }), {
      target: { value: '50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Vencido' }));
    expect(screen.getByText(/Saldo 10/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar baja' }));

    await screen.findByText('No hay saldo suficiente en ese lote y bodega.');
    await waitFor(() => expect(consultasDeStock()).toBe(2));
    await screen.findByText(/Saldo 3/);
    expect(screen.queryByText(/Saldo 10/)).toBeNull();
  });
});
