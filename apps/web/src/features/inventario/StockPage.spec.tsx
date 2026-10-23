import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stockDb } from '@/offline/stockDb.ts';
import { SesionContext } from '@/shared/sesion.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { StockPage } from './StockPage.tsx';
import { useStock } from './useStock.ts';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

vi.mock('@/offline/stockDb.ts', () => ({
  stockDb: { leer: vi.fn(), guardar: vi.fn() },
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
const SANTA_ISABEL = 'cccccccc-3636-4363-8363-cccccccccccc';
const CUBA = 'dddddddd-3636-4363-8363-dddddddddddd';

const arroz: LoteEnStock['referencia'] = {
  id: 'referencia-arroz',
  presentacion: '1 kg',
  producto: { id: 'producto-arroz', nombre: 'Arroz' },
  categoria: { id: 'categoria-arroz', codigo: 'C801', nombre: 'Arroz' },
};

const frijol: LoteEnStock['referencia'] = {
  id: 'referencia-frijol',
  presentacion: '500 g',
  producto: { id: 'producto-frijol', nombre: 'Fríjol' },
  categoria: { id: 'categoria-granos', codigo: 'C802', nombre: 'Granos' },
};

function lote(datos: Partial<LoteEnStock> & Pick<LoteEnStock, 'loteId'>): LoteEnStock {
  return {
    bodegaId: SANTA_ISABEL,
    codigo: null,
    vencimiento: '2027-03-31',
    estado: 'vigente',
    diasParaVencer: 160,
    semaforo: 'verde',
    cantidad: '10',
    kilos: '10',
    referencia: arroz,
    ...datos,
  };
}

const lotes: LoteEnStock[] = [
  lote({
    loteId: 'lote-1',
    codigo: 'L-1',
    vencimiento: '2026-09-30',
    estado: 'vencido',
    diasParaVencer: -21,
    semaforo: null,
    cantidad: '4',
    kilos: '4',
  }),
  lote({ loteId: 'lote-2', codigo: 'L-2', bodegaId: CUBA, cantidad: '6', kilos: '6' }),
  lote({
    loteId: 'lote-3',
    referencia: frijol,
    vencimiento: null,
    estado: 'sin_vencimiento',
    diasParaVencer: null,
    semaforo: null,
    cantidad: '8',
    kilos: '4',
  }),
];

function respuesta(cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function preparar() {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>
      <SesionContext.Provider value={{ rol: 'coordinacion', bancoId: BANCO, institucionId: null }}>
        {children}
      </SesionContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper };
}

describe('stock por bodega (SBA-36)', () => {
  beforeEach(() => {
    vi.mocked(stockDb.leer).mockReset().mockResolvedValue(undefined);
    vi.mocked(stockDb.guardar).mockReset().mockResolvedValue(BANCO);
  });

  it('muestra cada lote con su bodega, vencimiento y estado, y guarda la copia con la hora', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(lotes));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    await screen.findByRole('heading', { name: 'Arroz 1 kg' });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/stock$/), expect.any(Object));
    expect(screen.getByText('C801 · Arroz · 10 unidades en total (10 kg)')).toBeTruthy();
    expect(screen.getByText('Vence 30/09/2026 · Vencido')).toBeTruthy();
    expect(screen.getByText('Lote L-2 · Bodega dddddddd')).toBeTruthy();
    expect(screen.getByText('Sin fecha · Sin vencimiento')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/^Última sincronización: /);
    expect(screen.getByRole('status').textContent).not.toMatch(/desactualizado/);
    await waitFor(() =>
      expect(stockDb.guardar).toHaveBeenCalledWith({
        bancoId: BANCO,
        lotes,
        obtenidoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });

  it('sin red muestra el último dato conocido con la hora en que se obtuvo', async () => {
    const obtenidoEn = '2026-10-14T13:05:00.000Z';
    vi.mocked(stockDb.leer).mockResolvedValue({ bancoId: BANCO, lotes, obtenidoEn });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    await screen.findByRole('heading', { name: 'Fríjol 500 g' });
    const hora = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        `Última sincronización: ${hora.format(new Date(obtenidoEn))} · posiblemente desactualizado`,
      ),
    );
    expect(stockDb.guardar).not.toHaveBeenCalled();
  });

  it('sin red, un lote que venció después de guardar la copia se ve vencido', async () => {
    const copia = [
      lote({
        loteId: 'lote-viejo',
        vencimiento: '2020-01-31',
        estado: 'vigente',
        semaforo: 'rojo',
      }),
    ];
    vi.mocked(stockDb.leer).mockResolvedValue({
      bancoId: BANCO,
      lotes: copia,
      obtenidoEn: '2020-01-15T13:05:00.000Z',
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    expect(await screen.findByText('Vence 31/01/2020 · Vencido')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sale hoy' })).toBeNull();
  });

  it('si la API responde con error, la copia en pantalla se avisa como desactualizada', async () => {
    const obtenidoEn = '2026-10-14T13:05:00.000Z';
    vi.mocked(stockDb.leer).mockResolvedValue({ bancoId: BANCO, lotes, obtenidoEn });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    await screen.findByRole('heading', { name: 'Fríjol 500 g' });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/posiblemente desactualizado$/),
    );
  });

  describe('cuando la API responde con error después de haber respondido bien', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('recalcula el vencimiento con el día de hoy, no el de la última respuesta', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-22T15:00:00Z'));
      const venceHoy = [
        lote({
          loteId: 'lote-hoy',
          vencimiento: '2026-10-22',
          estado: 'vigente',
          diasParaVencer: 0,
          semaforo: 'rojo',
        }),
      ];
      const fetchMock = vi.fn().mockResolvedValueOnce(respuesta(venceHoy));
      vi.stubGlobal('fetch', fetchMock);
      const { wrapper } = preparar();
      const { result } = renderHook(() => useStock(), { wrapper });
      await waitFor(() => expect(result.current.data?.lotes[0]?.semaforo).toBe('rojo'));

      vi.setSystemTime(new Date('2026-10-23T15:00:00Z'));
      fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
      await result.current.refetch();

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.data?.desactualizado).toBe(true);
      expect(result.current.data?.lotes[0]).toMatchObject({
        estado: 'vencido',
        diasParaVencer: -1,
        semaforo: null,
      });
    });
  });

  it('sin red y sin copia avisa que no pudo consultar', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('lista primero lo que sale hoy, luego esta semana y este mes, sin vencidos (SBA-37)', async () => {
    const enSemaforo = [
      ...lotes,
      lote({ loteId: 'mes', codigo: 'L-MES', diasParaVencer: 20, semaforo: 'verde' }),
      lote({ loteId: 'semana', codigo: 'L-SEM', diasParaVencer: 6, semaforo: 'amarillo' }),
      lote({ loteId: 'hoy-2', codigo: 'L-H2', diasParaVencer: 2, semaforo: 'rojo' }),
      lote({ loteId: 'hoy-0', codigo: 'L-H0', diasParaVencer: 0, semaforo: 'rojo' }),
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(enSemaforo)));
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    const seccion = await screen.findByRole('region', { name: 'Salida prioritaria' });
    const titulos = within(seccion)
      .getAllByRole('heading', { level: 3 })
      .map((titulo) => titulo.textContent);
    expect(titulos).toEqual(['Sale hoy', 'Sale esta semana', 'Sale este mes']);
    const filas = within(seccion)
      .getAllByRole('listitem')
      .map((fila) => fila.textContent);
    expect(filas).toEqual([
      'Arroz 1 kg · Lote L-H0Vence hoy · Bodega cccccccc · 10 unidades',
      'Arroz 1 kg · Lote L-H2Vence en 2 días · Bodega cccccccc · 10 unidades',
      'Arroz 1 kg · Lote L-SEMVence en 6 días · Bodega cccccccc · 10 unidades',
      'Arroz 1 kg · Lote L-MESVence en 20 días · Bodega cccccccc · 10 unidades',
    ]);
    expect(screen.getAllByText(/· Vigente · Rojo$/)).toHaveLength(2);
  });

  it('sin umbrales en el banco lo dice en vez de dejar la lista vacía', async () => {
    const sinSemaforo = lotes.map((l) => ({ ...l, semaforo: null }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(sinSemaforo)));
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });

    expect(await screen.findByText(/El banco no tiene umbrales de semáforo/)).toBeTruthy();
  });

  it('filtra por bodega, categoría y referencia sin volver a consultar', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(lotes));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = preparar();
    render(<StockPage />, { wrapper });
    await screen.findByRole('heading', { name: 'Arroz 1 kg' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Bodega' }), {
      target: { value: CUBA },
    });
    expect(screen.getByText('Lote L-2 · Bodega dddddddd')).toBeTruthy();
    expect(screen.queryByText(/Lote L-1/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Fríjol 500 g' })).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Bodega' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), {
      target: { value: 'categoria-granos' },
    });
    expect(screen.getByRole('heading', { name: 'Fríjol 500 g' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Arroz 1 kg' })).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Categoría' }), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Referencia' }), {
      target: { value: 'referencia-arroz' },
    });
    expect(screen.getByRole('heading', { name: 'Arroz 1 kg' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Fríjol 500 g' })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
