import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogoDb } from '@/offline/catalogoDb.ts';
import type { Catalogo } from '@/shared/catalogo.ts';
import { SesionContext } from '@/shared/sesion.ts';
import type { ComandoDeRecepcion, RecepcionConfirmada } from './enviarRecepcion.ts';
import { RecepcionPage } from './RecepcionPage.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

vi.mock('@/offline/catalogoDb.ts', () => ({
  catalogoDb: { leer: vi.fn(), guardar: vi.fn() },
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
const BODEGA = { id: 'bodega-1', nombre: 'Bodega principal', direccion: null, activa: true };
const DONANTE = {
  id: 'donante-1',
  nombre: 'Parroquia San José',
  tipo: 'parroquia',
  contacto: null,
  activo: true,
};

const catalogo: Catalogo = {
  version: 'v1',
  categorias: [
    {
      id: 'categoria-1',
      codigo: 'C801',
      nombre: 'Arroz',
      linea: 'Cereales',
      descripcion: null,
      productos: [
        {
          id: 'producto-1',
          nombre: 'Arroz',
          referencias: [
            {
              id: 'referencia-1',
              presentacion: '1 kg',
              equivalenciaKg: '1',
              creadaDesdeCelular: false,
            },
          ],
        },
      ],
    },
  ],
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function confirmada(comando: ComandoDeRecepcion): RecepcionConfirmada {
  return {
    id: 'recepcion-1',
    donanteId: comando.donanteId,
    origen: comando.origen,
    bodegaId: comando.bodegaId,
    registradaEn: '2026-10-21T15:00:00.000Z',
    detalles: comando.detalles.map((detalle) => ({
      ...detalle,
      loteId: 'lote-1',
      kilos: detalle.cantidad,
      valoracion: 'pendiente',
    })),
  };
}

/** Responde bodegas, donantes y catálogo; `recepcion` decide qué pasa con el POST. */
function api(recepcion: (comando: ComandoDeRecepcion) => Promise<Response>) {
  return vi.fn(async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const ruta = String(entrada);
    if (ruta.endsWith('/bodegas')) return json([BODEGA, { ...BODEGA, id: 'b-2', activa: false }]);
    if (ruta.includes('/donantes')) return json([DONANTE]);
    if (ruta.endsWith('/catalogo')) return json(catalogo);
    if (ruta.endsWith('/recepciones')) {
      return recepcion(JSON.parse(String(opciones?.body)) as ComandoDeRecepcion);
    }
    throw new Error(`ruta inesperada: ${ruta}`);
  });
}

function comandosEnviados(fetchMock: ReturnType<typeof api>): ComandoDeRecepcion[] {
  return fetchMock.mock.calls
    .filter(([ruta]) => String(ruta).endsWith('/recepciones'))
    .map(([, opciones]) => JSON.parse(String(opciones?.body)) as ComandoDeRecepcion);
}

function montar() {
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
  render(<RecepcionPage />, { wrapper });
}

async function llenar() {
  await screen.findByRole('option', { name: 'Bodega principal' });
  const bodegas = screen.getByRole('combobox', { name: 'Bodega' });
  // La inactiva no se ofrece: queda la indicación y la bodega activa.
  expect(within(bodegas).getAllByRole('option')).toHaveLength(2);
  fireEvent.change(bodegas, { target: { value: 'bodega-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Propia' }));

  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar donante' }), {
    target: { value: 'san' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Parroquia San José · Parroquia' }));

  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar referencia 1' }), {
    target: { value: 'arroz' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Arroz 1 kg' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad' }), {
    target: { value: '12,5' },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Lote' }), { target: { value: ' L-7 ' } });
  fireEvent.change(screen.getByLabelText('Vence'), { target: { value: '2027-03-01' } });
}

describe('pantalla de recepción', () => {
  beforeEach(() => {
    vi.mocked(catalogoDb.leer).mockResolvedValue(undefined);
    vi.mocked(catalogoDb.guardar).mockResolvedValue(BANCO);
  });

  it('confirma la recepción y marca la valoración pendiente', async () => {
    const fetchMock = api(async (comando) => json(confirmada(comando), 201));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await llenar();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));

    await screen.findByRole('heading', { name: 'Recepción confirmada' });
    expect(screen.getByText('Valoración pendiente')).toBeTruthy();
    const [comando] = comandosEnviados(fetchMock);
    expect(comando).toMatchObject({
      donanteId: 'donante-1',
      origen: 'propia',
      bodegaId: 'bodega-1',
      detalles: [
        {
          referenciaId: 'referencia-1',
          cantidad: '12.5',
          lote: 'L-7',
          vencimiento: '2027-03-01',
          novedad: null,
        },
      ],
    });
    expect(comando?.comandoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  });

  it('sin señal reintenta con el mismo comando', async () => {
    let intentos = 0;
    const fetchMock = api(async (comando) => {
      intentos += 1;
      if (intentos === 1) throw new TypeError('Network error');
      return json(confirmada(comando), 200);
    });
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await llenar();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));
    await screen.findByText(/Sin señal · no se registró todavía/);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    await screen.findByRole('heading', { name: 'Recepción confirmada' });
    const [primero, segundo] = comandosEnviados(fetchMock);
    expect(segundo).toEqual(primero);
  });

  it('no envía si falta la cantidad, y lo dice', async () => {
    const fetchMock = api(async (comando) => json(confirmada(comando), 201));
    vi.stubGlobal('fetch', fetchMock);
    montar();

    await llenar();
    fireEvent.change(screen.getByRole('textbox', { name: 'Cantidad' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recepción' }));

    await screen.findByText('Escribe una cantidad mayor que cero en la referencia 1.');
    await waitFor(() => expect(comandosEnviados(fetchMock)).toEqual([]));
  });
});
