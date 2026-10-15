import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BodegaDto } from '@sigba/shared-types';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext } from '@/shared/sesion';
import { PantallaBodegas } from './PantallaBodegas.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-token') }),
}));

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const admin: AsignacionActiva = { rol: 'admin_banco', bancoId: bancoA, institucionId: null };
const operario: AsignacionActiva = { ...admin, rol: 'operario_bodega' };

const central: BodegaDto = { id: 'b-1', nombre: 'Central', direccion: 'Calle 1', activa: true };
const vieja: BodegaDto = { id: 'b-2', nombre: 'Vieja', direccion: null, activa: false };

/** Responde a la API según método y ruta; lo que no conoce es 404. */
function api(respuestas: Record<string, () => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opciones) => {
    const ruta = String(url).replace(/^.*\/api\/v1/, '');
    const responder = respuestas[`${opciones?.method ?? 'GET'} ${ruta}`];
    return responder ? responder() : new Response('{}', { status: 404 });
  });
}
const json =
  (cuerpo: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(cuerpo), { status });

function montar(asignacion: AsignacionActiva) {
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltura = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={consultas}>
      <SesionContext value={asignacion}>{children}</SesionContext>
    </QueryClientProvider>
  );
  return render(<PantallaBodegas />, { wrapper: envoltura });
}

describe('PantallaBodegas', () => {
  afterEach(() => vi.restoreAllMocks());

  it('muestra las activas y cuenta las que están sin uso', async () => {
    api({ 'GET /bodegas?incluirInactivas=true': json([central, vieja]) });

    montar(admin);

    expect(await screen.findByText('Central')).toBeInTheDocument();
    expect(screen.queryByText('Vieja')).toBeNull();
    expect(screen.getByText('1 activa · 1 sin uso')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByText('Vieja')).toBeInTheDocument();
  });

  it('admin_banco crea una bodega en la última fila de la lista', async () => {
    const fetch = api({
      'GET /bodegas?incluirInactivas=true': json([central]),
      'POST /bodegas': json({ ...central, id: 'b-3', nombre: 'Norte' }, 201),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: 'Nueva bodega' }));
    fireEvent.change(screen.getByLabelText('Nombre de la bodega'), {
      target: { value: '  Norte ' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva bodega' }));

    await waitFor(() => {
      const post = fetch.mock.calls.find(([, opciones]) => opciones?.method === 'POST');
      expect(post?.[1]?.body).toBe(JSON.stringify({ nombre: 'Norte' }));
    });
  });

  it('dice qué pasó si el nombre ya existe', async () => {
    api({
      'GET /bodegas?incluirInactivas=true': json([central]),
      'POST /bodegas': json({}, 409),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: 'Nueva bodega' }));
    fireEvent.change(screen.getByLabelText('Nombre de la bodega'), {
      target: { value: 'central' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva bodega' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya hay una bodega con ese nombre en este banco.',
    );
  });

  it('edita en una hoja y deja la bodega sin uso', async () => {
    const fetch = api({
      'GET /bodegas?incluirInactivas=true': json([central]),
      'POST /bodegas/b-1/desactivar': json({ ...central, activa: false }),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Central/ }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByLabelText('Nombre')).toHaveValue('Central');
    fireEvent.click(within(hoja).getByRole('button', { name: 'Dejar sin uso' }));

    await waitFor(() =>
      expect(fetch.mock.calls.map(([url]) => String(url))).toContainEqual(
        expect.stringMatching(/\/bodegas\/b-1\/desactivar$/),
      ),
    );
  });

  it('operario_bodega ve la lista sin poder crear ni editar', async () => {
    api({ 'GET /bodegas?incluirInactivas=true': json([central]) });

    montar(operario);

    expect(await screen.findByText('Central')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Central/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nueva bodega' })).toBeNull();
  });
});
