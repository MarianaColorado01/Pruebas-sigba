import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { SesionContext } from '@/shared/sesion.ts';
import { CrearPresentacion } from './CrearPresentacion.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
const ARROZ = '66666666-6666-4666-8666-666666666666';

const kilo: ReferenciaDelCatalogo = {
  id: 'referencia-kilo',
  presentacion: '1 kg',
  equivalenciaKg: '1',
  creadaDesdeCelular: false,
  activa: true,
  producto: { id: ARROZ, nombre: 'Arroz' },
  categoria: { id: 'categoria-1', codigo: 'C801', nombre: 'Arroz', linea: 'Cereales' },
};

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function montar() {
  const onLista = vi.fn();
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <SesionContext.Provider
        value={{ rol: 'operario_bodega', bancoId: BANCO, institucionId: null }}
      >
        <CrearPresentacion productos={[{ id: ARROZ, nombre: 'Arroz' }]} onLista={onLista} />
      </SesionContext.Provider>
    </QueryClientProvider>,
  );
  return onLista;
}

function llenar(presentacion: string, kilos: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Producto' }), {
    target: { value: ARROZ },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Presentación' }), {
    target: { value: presentacion },
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Equivale a (kg)' }), {
    target: { value: kilos },
  });
}

/** Los cuerpos de los POST que recibió el fetch simulado. */
function envios(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([, opciones]) => (opciones as RequestInit | undefined)?.method === 'POST')
    .map(
      ([, opciones]) =>
        JSON.parse(String((opciones as RequestInit).body)) as Record<string, string>,
    );
}

describe('crear presentación desde el celular', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sugiere la que ya existe con otro nombre y no crea si el operario la elige', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([kilo]));
    vi.stubGlobal('fetch', fetchMock);
    const onLista = montar();

    llenar('1000 g', '1');
    fireEvent.click(screen.getByRole('button', { name: 'Crear presentación' }));
    fireEvent.click(await screen.findByRole('button', { name: /Arroz 1 kg/ }));

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/productos/${ARROZ}/presentaciones-similares?presentacion=1000+g&equivalenciaKg=1`,
    );
    expect(onLista).toHaveBeenCalledWith(kilo);
    expect(envios(fetchMock)).toEqual([]);
  });

  it('sin similares la crea, dice «pendiente de sincronizar» mientras espera y la deja lista', async () => {
    const creada = {
      ...kilo,
      id: 'referencia-480',
      presentacion: '480 g',
      creadaDesdeCelular: true,
    };
    let responder: (respuesta: Response) => void = () => undefined;
    const fetchMock = vi.fn((_ruta: string, opciones?: RequestInit) =>
      opciones?.method === 'POST'
        ? new Promise<Response>((resolver) => (responder = resolver))
        : Promise.resolve(json([])),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onLista = montar();

    llenar('480 g', '0,48');
    fireEvent.click(screen.getByRole('button', { name: 'Crear presentación' }));

    await screen.findByText('Arroz 480 g · pendiente de sincronizar');
    responder(json(creada, 201));
    await waitFor(() => expect(onLista).toHaveBeenCalledWith(creada));

    const [cuerpo] = envios(fetchMock);
    expect(cuerpo).toMatchObject({
      productoId: ARROZ,
      presentacion: '480 g',
      equivalenciaKg: '0,48',
    });
    expect(cuerpo?.['comandoId']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sin señal no la da por creada y el reintento manda el mismo comando', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json([]))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ ...kilo, id: 'referencia-480' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    const onLista = montar();

    llenar('480 g', '0.48');
    fireEvent.click(screen.getByRole('button', { name: 'Crear presentación' }));
    await screen.findByText(/Sin señal · no se creó todavía/);
    expect(onLista).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(onLista).toHaveBeenCalled());

    const [primero, segundo] = envios(fetchMock);
    expect(segundo?.['comandoId']).toBe(primero?.['comandoId']);
  });
});
