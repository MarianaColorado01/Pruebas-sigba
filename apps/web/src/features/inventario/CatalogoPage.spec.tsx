import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogoDb } from '@/offline/catalogoDb.ts';
import type { Catalogo, ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { SesionContext } from '@/shared/sesion.ts';
import { CatalogoPage } from './CatalogoPage.tsx';
import { useCatalogo } from './useCatalogo.ts';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

vi.mock('@/offline/catalogoDb.ts', () => ({
  catalogoDb: { leer: vi.fn(), guardar: vi.fn() },
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
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

const referencia: ReferenciaDelCatalogo = {
  id: 'referencia-1',
  presentacion: '1 kg',
  equivalenciaKg: '1',
  creadaDesdeCelular: false,
  activa: true,
  producto: { id: 'producto-1', nombre: 'Arroz' },
  categoria: { id: 'categoria-1', codigo: 'C801', nombre: 'Arroz', linea: 'Cereales' },
};

function preparar() {
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
  return { cliente, wrapper };
}

describe('catálogo de inventario', () => {
  beforeEach(() => {
    vi.mocked(catalogoDb.leer).mockResolvedValue({ bancoId: BANCO, etag: 'v1', catalogo });
    vi.mocked(catalogoDb.guardar).mockResolvedValue(BANCO);
  });

  it('conserva la copia si el servidor confirma el mismo ETag con 304', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 304, headers: { ETag: 'v1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = preparar();
    const { result } = renderHook(() => useCatalogo(), { wrapper });

    await waitFor(() => expect(result.current.data?.desactualizado).toBe(false));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const opciones = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(opciones.headers).get('If-None-Match')).toBe('v1');
    expect(catalogoDb.guardar).not.toHaveBeenCalled();
  });

  it('guarda el catálogo solo cuando el servidor devuelve un ETag nuevo', async () => {
    const nuevo: Catalogo = { ...catalogo, version: 'v2' };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(nuevo), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ETag: 'v2' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = preparar();
    const { result } = renderHook(() => useCatalogo(), { wrapper });

    await waitFor(() => expect(result.current.data?.catalogo.version).toBe('v2'));

    expect(catalogoDb.guardar).toHaveBeenCalledWith({
      bancoId: BANCO,
      etag: 'v2',
      catalogo: nuevo,
    });
    expect(result.current.data?.desactualizado).toBe(false);
    const opciones = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(opciones.headers).get('If-None-Match')).toBe('v1');
  });

  it('consulta cada texto escrito y agrupa el resultado por categoría', async () => {
    vi.mocked(catalogoDb.leer).mockResolvedValue(undefined);
    const fetchMock = vi.fn(async (entrada: RequestInfo | URL) => {
      const ruta = String(entrada);
      if (ruta.endsWith('/catalogo')) {
        return new Response(JSON.stringify(catalogo), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ETag: 'v1' },
        });
      }
      return new Response(JSON.stringify([referencia]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { wrapper } = preparar();
    render(<CatalogoPage />, { wrapper });

    const buscar = screen.getByRole('searchbox', { name: 'Buscar referencia' });
    fireEvent.change(buscar, { target: { value: 'a' } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/referencias?texto=a'),
        expect.any(Object),
      ),
    );
    fireEvent.change(buscar, { target: { value: 'ar' } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/referencias?texto=ar'),
        expect.any(Object),
      ),
    );
    fireEvent.change(buscar, { target: { value: 'arr' } });

    await screen.findByRole('button', { name: 'Arroz 1 kg' });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/referencias?texto=arr'),
        expect.any(Object),
      ),
    );
    expect(screen.getByRole('heading', { name: 'C801 · Arroz · Cereales' })).toBeTruthy();
  });

  it('muestra la copia y permite buscar sin red con aviso de posible desactualización', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));
    const { wrapper } = preparar();
    render(<CatalogoPage />, { wrapper });

    await screen.findByText('Catálogo guardado; posiblemente desactualizado.');
    const buscar = screen.getByRole('searchbox', { name: 'Buscar referencia' });
    fireEvent.change(buscar, { target: { value: 'arr' } });

    await screen.findByRole('button', { name: 'Arroz 1 kg' });
    expect(screen.getByText('Catálogo guardado; posiblemente desactualizado.')).toBeTruthy();
  });
});
