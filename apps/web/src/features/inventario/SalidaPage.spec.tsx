import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stockDb } from '@/offline/stockDb.ts';
import type { ComandoDeSalida, Salida } from '@/shared/salidas.ts';
import { SesionContext } from '@/shared/sesion.ts';
import type { LoteEnStock } from '@/shared/stock.ts';
import { SalidaPage } from './SalidaPage.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

vi.mock('@/offline/stockDb.ts', () => ({
  stockDb: { leer: vi.fn(), guardar: vi.fn() },
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
const BODEGA = 'cccccccc-3838-4383-8383-cccccccccccc';
const INSTITUCION = 'eeeeeeee-3838-4383-8383-eeeeeeeeeeee';

const arroz: LoteEnStock['referencia'] = {
  id: 'referencia-arroz',
  presentacion: '1 kg',
  producto: { id: 'producto-arroz', nombre: 'Arroz' },
  categoria: { id: 'categoria-arroz', codigo: 'C801', nombre: 'Arroz' },
};

function lote(datos: Partial<LoteEnStock> & Pick<LoteEnStock, 'loteId'>): LoteEnStock {
  return {
    bodegaId: BODEGA,
    codigo: null,
    vencimiento: '2027-03-31',
    estado: 'vigente',
    diasParaVencer: 100,
    semaforo: 'verde',
    cantidad: '10',
    kilos: '10',
    referencia: arroz,
    ...datos,
  };
}

const lotes: LoteEnStock[] = [
  lote({ loteId: 'lote-tarde', codigo: 'L-TARDE', vencimiento: '2027-06-30' }),
  lote({ loteId: 'lote-pronto', codigo: 'L-PRONTO', vencimiento: '2026-11-05' }),
  lote({
    loteId: 'lote-vencido',
    codigo: 'L-VENCIDO',
    vencimiento: '2026-01-01',
    estado: 'vencido',
  }),
];

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function registrada(comando: ComandoDeSalida): Salida {
  return {
    id: 'salida-1',
    institucionId: comando.institucionId,
    bodegaId: comando.bodegaId,
    despachador: comando.despachador,
    despachadorTipo: comando.despachadorTipo,
    aportePct: '8',
    registradaEn: '2026-10-21T15:00:00.000Z',
    detalles: comando.detalles.map((d) => ({
      ...d,
      categoriaId: 'categoria-arroz',
      kilos: d.cantidad,
      valoracion: 'con_precio',
      valorUnitario: '2800',
      fuente: 'sipsa',
      valorComercial: String(Number(d.cantidad) * 2800),
      aporte: String(Number(d.cantidad) * 224),
    })),
  };
}

function preparar(salidas: (comando: ComandoDeSalida) => Response) {
  const fetchMock = vi.fn(async (url: string, opciones: RequestInit) => {
    if (url.endsWith('/stock')) return respuesta(lotes);
    if (url.endsWith('/salidas/instituciones')) {
      return respuesta([{ id: INSTITUCION, nombre: 'Parroquia San José' }]);
    }
    if (url.endsWith('/salidas')) return salidas(JSON.parse(String(opciones.body)));
    return respuesta({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>
      <SesionContext.Provider
        value={{ rol: 'operario_bodega', bancoId: BANCO, institucionId: null }}
      >
        {children}
      </SesionContext.Provider>
    </QueryClientProvider>
  );
  render(<SalidaPage />, { wrapper });
  return fetchMock;
}

async function llenar() {
  await screen.findByRole('option', { name: 'Parroquia San José' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Institución' }), {
    target: { value: INSTITUCION },
  });
  await screen.findByRole('option', { name: 'Bodega cccccccc' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Bodega' }), {
    target: { value: BODEGA },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Referencia' }), {
    target: { value: 'referencia-arroz' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad (unidades)' }), {
    target: { value: '4' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Quién despacha' }), {
    target: { value: 'Operario sintético' },
  });
}

describe('salida a institución (SBA-38)', () => {
  beforeEach(() => {
    vi.mocked(stockDb.leer).mockReset().mockResolvedValue(undefined);
    vi.mocked(stockDb.guardar).mockReset().mockResolvedValue(BANCO);
  });

  it('sugiere el lote que vence primero, sin vencidos, y deja cambiarlo', async () => {
    preparar((comando) => respuesta(registrada(comando), 201));
    await llenar();

    const lote = screen.getByRole('combobox', { name: 'Lote' }) as HTMLSelectElement;
    expect(lote.value).toBe('lote-pronto');
    expect([...lote.options].map((o) => o.textContent)).toEqual([
      'Lote L-PRONTO · vence 05/11/2026 · hay 10 · sugerido',
      'Lote L-TARDE · vence 30/06/2027 · hay 10',
    ]);
    fireEvent.change(lote, { target: { value: 'lote-tarde' } });
    expect(lote.value).toBe('lote-tarde');
  });

  it('manda un comando con ids del cliente y muestra el comprobante con el aporte', async () => {
    const fetchMock = preparar((comando) => respuesta(registrada(comando), 201));
    await llenar();

    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));

    await screen.findByRole('heading', { name: 'Salida registrada' });
    const envio = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/salidas'));
    const comando = JSON.parse(String(envio?.[1].body)) as ComandoDeSalida;
    expect(comando).toMatchObject({
      institucionId: INSTITUCION,
      bodegaId: BODEGA,
      despachador: 'Operario sintético',
      despachadorTipo: 'funcionario',
      detalles: [{ referenciaId: 'referencia-arroz', loteId: 'lote-pronto', cantidad: '4' }],
    });
    expect(comando.comandoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(comando.detalles[0]?.movimientoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/Para Parroquia San José/)).toBeTruthy();
    expect(screen.getByText(/Arroz 1 kg · 4 unidades/)).toBeTruthy();
    expect(screen.getByText(/aporte del 8 %/)).toBeTruthy();
  });

  it('si falla la señal, reintentar manda el mismo comando', async () => {
    let intentos = 0;
    const fetchMock = preparar((comando) => {
      intentos += 1;
      if (intentos === 1) throw new TypeError('Network error');
      return respuesta(registrada(comando), 201);
    });
    await llenar();

    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));
    await screen.findByText(/Sin señal\. La salida no se registró/);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('heading', { name: 'Salida registrada' });

    const envios = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/salidas'))
      .map(([, opciones]) => (JSON.parse(String(opciones.body)) as ComandoDeSalida).comandoId);
    expect(envios).toHaveLength(2);
    expect(envios[0]).toBe(envios[1]);
  });

  it('sin stock avisa que revise las cantidades y vuelve a consultar el stock', async () => {
    const fetchMock = preparar(() =>
      respuesta(
        {
          statusCode: 409,
          codigo: 'sin_stock',
          message: 'No hay stock suficiente.',
          faltantes: [],
        },
        409,
      ),
    );
    await llenar();

    fireEvent.click(screen.getByRole('button', { name: 'Registrar salida' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'No hay stock suficiente en la bodega para esta salida. Revisa las cantidades con el stock actualizado.',
    );
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/stock'))).toHaveLength(
        2,
      ),
    );
    expect(screen.getByRole('button', { name: 'Registrar salida' })).toBeTruthy();
  });
});
