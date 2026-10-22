import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Rol } from '@sigba/shared-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogoDb } from '@/offline/catalogoDb.ts';
import type { Catalogo } from '@/shared/catalogo.ts';
import { SesionContext } from '@/shared/sesion.ts';
import type { Precio } from './datos.ts';
import { PreciosPage } from './PreciosPage.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

vi.mock('@/offline/catalogoDb.ts', () => ({
  catalogoDb: { leer: vi.fn(), guardar: vi.fn() },
}));

const BANCO = '55555555-5555-4555-8555-555555555555';
const REFERENCIA = 'referencia-1';

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
              id: REFERENCIA,
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

function precio(datos: Partial<Precio>): Precio {
  return {
    id: 'precio-1',
    referenciaId: REFERENCIA,
    valor: '4200',
    piso: '3800',
    techo: '4500',
    fuente: 'remision',
    evidencia: 'Remisión 4521',
    vigenteDesde: '2026-10-01',
    vigenteHasta: '2026-10-30',
    estado: 'propuesto',
    motivoFueraDeBanda: null,
    aprobadoPor: null,
    aprobadoEn: null,
    creadoPor: 'usuario-sintetico',
    creadoEn: '2026-10-01T12:00:00.000Z',
    ...datos,
  };
}

function json(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function api(historial: Precio[], escritura?: (ruta: string, cuerpo: unknown) => Response) {
  return vi.fn(async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    const ruta = String(entrada);
    if (ruta.endsWith('/catalogo')) return json(catalogo);
    if (ruta.endsWith('/precios') && opciones?.method !== 'POST') return json(historial);
    if (ruta.endsWith('/precio-vigente')) {
      const vigente = historial.find((p) => p.estado === 'aprobado') ?? null;
      return json({
        referenciaId: REFERENCIA,
        fecha: '2026-10-21',
        valoracion: vigente ? 'con_precio' : 'pendiente',
        precio: vigente,
      });
    }
    if (opciones?.method === 'POST' && escritura) {
      return escritura(ruta, JSON.parse(String(opciones.body)));
    }
    throw new Error(`ruta inesperada: ${ruta}`);
  });
}

function escrituras(fetchMock: ReturnType<typeof api>) {
  return fetchMock.mock.calls
    .filter(([, opciones]) => opciones?.method === 'POST')
    .map(([ruta, opciones]) => ({
      ruta: String(ruta),
      cuerpo: JSON.parse(String(opciones?.body)),
    }));
}

function montar(rol: Rol) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>
      <SesionContext.Provider value={{ rol, bancoId: BANCO, institucionId: null }}>
        {children}
      </SesionContext.Provider>
    </QueryClientProvider>
  );
  render(<PreciosPage />, { wrapper });
}

async function elegirArroz() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Buscar referencia' }), {
    target: { value: 'arroz' },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Arroz 1 kg' }));
}

describe('pantalla del maestro de precios', () => {
  beforeEach(() => {
    vi.mocked(catalogoDb.leer).mockResolvedValue(undefined);
    vi.mocked(catalogoDb.guardar).mockResolvedValue(BANCO);
  });

  it('sin precio aprobado avisa que las recepciones quedan con valoración pendiente', async () => {
    vi.stubGlobal('fetch', api([precio({})]));
    montar('coordinacion');

    await elegirArroz();

    await screen.findByText(/Sin precio vigente aprobado/);
    expect(screen.getByText('Propuesto')).toBeTruthy();
  });

  it('propone con pesos a punto de miles, fuente y evidencia', async () => {
    const fetchMock = api([], (_ruta, cuerpo) =>
      json({ ...precio({}), ...(cuerpo as object) }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);
    montar('coordinacion');

    await elegirArroz();
    fireEvent.change(screen.getByRole('textbox', { name: 'Valor' }), {
      target: { value: '4.200' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Piso' }), { target: { value: '3800' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Techo' }), {
      target: { value: '4.500,50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remisión' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Evidencia' }), {
      target: { value: 'Remisión 4521' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Proponer precio' }));

    await screen.findByText('Precio propuesto. Falta aprobarlo para que rija.');
    const [envio] = escrituras(fetchMock);
    expect(envio?.ruta).toMatch(/\/precios$/);
    expect(envio?.cuerpo).toMatchObject({
      referenciaId: REFERENCIA,
      valor: '4200',
      piso: '3800',
      techo: '4500.50',
      fuente: 'remision',
      evidencia: 'Remisión 4521',
      vigenteHasta: null,
    });
  });

  it('muestra el rechazo de la API al proponer', async () => {
    const fetchMock = api([], () =>
      json({ message: 'El piso no puede ser mayor que el techo.' }, 400),
    );
    vi.stubGlobal('fetch', fetchMock);
    montar('coordinacion');

    await elegirArroz();
    fireEvent.change(screen.getByRole('textbox', { name: 'Valor' }), { target: { value: '10' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Piso' }), { target: { value: '20' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Techo' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Evidencia' }), {
      target: { value: 'Cotización' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Proponer precio' }));

    await screen.findByText('El piso no puede ser mayor que el techo.');
  });

  it('fuera de banda pide el motivo antes de aprobar y lo envía', async () => {
    const fetchMock = api([precio({ valor: '5000' })], (_ruta, cuerpo) =>
      json({ ...precio({ valor: '5000', estado: 'aprobado' }), ...(cuerpo as object) }, 201),
    );
    vi.stubGlobal('fetch', fetchMock);
    montar('coordinacion');

    await elegirArroz();
    fireEvent.click(await screen.findByRole('button', { name: 'Aprobar precio' }));
    await screen.findByText('El valor está fuera de la banda. Escribe el motivo para aprobarlo.');
    expect(escrituras(fetchMock)).toEqual([]);

    fireEvent.change(screen.getByRole('textbox', { name: 'Motivo fuera de banda' }), {
      target: { value: 'Escasez por invierno' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar precio' }));

    await waitFor(() => expect(escrituras(fetchMock)).toHaveLength(1));
    const [envio] = escrituras(fetchMock);
    expect(envio?.ruta).toMatch(/\/precios\/precio-1\/aprobar$/);
    expect(envio?.cuerpo).toMatchObject({ motivoFueraDeBanda: 'Escasez por invierno' });
  });

  it('a quien no aprueba no le muestra aprobar ni proponer', async () => {
    vi.stubGlobal('fetch', api([precio({})]));
    montar('operario_bodega');

    await elegirArroz();

    await screen.findByText('Propuesto');
    expect(screen.queryByRole('button', { name: 'Aprobar precio' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Proponer precio' })).toBeNull();
  });
});
