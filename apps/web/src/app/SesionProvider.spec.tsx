import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AsignacionDeUsuario } from '@sigba/shared-types';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAsignacion } from '@/shared/sesion.ts';
import { SesionProvider } from './SesionProvider.tsx';
import { useBancoActivo } from './sesionActiva.ts';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token'),
    logout: vi.fn(),
  }),
}));

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bancoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const armenia: AsignacionDeUsuario = {
  rol: 'admin_banco',
  bancoId: bancoA,
  bancoNombre: 'Banco de Armenia',
  institucionId: null,
};
const manizales: AsignacionDeUsuario = {
  rol: 'consulta',
  bancoId: bancoB,
  bancoNombre: 'Banco de Manizales',
  institucionId: null,
};

function Sonda() {
  const asignacion = useAsignacion();
  const { cambiar } = useBancoActivo();
  return (
    <>
      <p>Trabajando en {asignacion?.bancoId}</p>
      <button type="button" onClick={cambiar}>
        Otro banco
      </button>
    </>
  );
}

function montar(respuesta: AsignacionDeUsuario[] | number) {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () =>
      typeof respuesta === 'number'
        ? new Response('{}', { status: respuesta })
        : new Response(JSON.stringify(respuesta), { status: 200 }),
    );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <SesionProvider>
        <Sonda />
      </SesionProvider>
    </QueryClientProvider>,
  );
  return { fetch, cliente };
}

const elegir = async (banco: string) =>
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(banco) }));

describe('SesionProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('pide las asignaciones sin banco en la cabecera', async () => {
    const { fetch } = montar([armenia]);

    await screen.findByText(`Trabajando en ${bancoA}`);
    const [ruta, opciones] = fetch.mock.calls[0] ?? [];
    expect(String(ruta)).toMatch(/\/yo\/asignaciones$/);
    expect(new Headers(opciones?.headers).has('x-banco-id')).toBe(false);
  });

  it('con una asignación la usa sin preguntar', async () => {
    montar([armenia]);

    expect(await screen.findByText(`Trabajando en ${bancoA}`)).toBeInTheDocument();
    expect(screen.queryByText('¿Con qué banco trabajas hoy?')).toBeNull();
  });

  it('con varias pregunta y recuerda solo el id del banco elegido', async () => {
    montar([armenia, manizales]);

    expect(await screen.findByText('¿Con qué banco trabajas hoy?')).toBeInTheDocument();
    expect(screen.queryByText(/Trabajando en/)).toBeNull();

    await elegir('Banco de Manizales');

    expect(screen.getByText(`Trabajando en ${bancoB}`)).toBeInTheDocument();
    expect({ ...localStorage }).toEqual({ 'sigba.bancoId': bancoB });
  });

  it('con varias arranca en el banco que recuerda', async () => {
    localStorage.setItem('sigba.bancoId', bancoB);
    montar([armenia, manizales]);

    expect(await screen.findByText(`Trabajando en ${bancoB}`)).toBeInTheDocument();
  });

  it('sin almacenamiento disponible pregunta y deja entrar igual', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    montar([armenia, manizales]);

    await elegir('Banco de Armenia');

    expect(screen.getByText(`Trabajando en ${bancoA}`)).toBeInTheDocument();
  });

  it('sin asignaciones explica que hace falta una invitación', async () => {
    montar([]);

    expect(
      await screen.findByRole('heading', {
        name: 'Tu cuenta aún no tiene acceso a un banco; pide una invitación',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Trabajando en/)).toBeNull();
  });

  it('si la API falla ofrece reintentar', async () => {
    montar(500);

    expect(await screen.findByText('No pudimos cargar tus bancos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('al cambiar de banco limpia la caché y conserva las asignaciones', async () => {
    const { cliente, fetch } = montar([armenia, manizales]);
    await elegir('Banco de Armenia');
    cliente.setQueryData(['bodegas'], [{ nombre: 'Bodega de Armenia' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Otro banco' }));
    expect(screen.getByRole('button', { name: /Seguir en Banco de Armenia/ })).toBeInTheDocument();
    await elegir('Banco de Manizales');

    expect(screen.getByText(`Trabajando en ${bancoB}`)).toBeInTheDocument();
    expect(cliente.getQueryData(['bodegas'])).toBeUndefined();
    expect(cliente.getQueryData(['yo', 'asignaciones'])).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('si le quitan el banco elegido pregunta en vez de saltar solo a otro', async () => {
    const { cliente, fetch } = montar([armenia, manizales]);
    await elegir('Banco de Armenia');
    fetch.mockImplementation(async () => new Response(JSON.stringify([manizales])));

    await act(() => cliente.refetchQueries({ queryKey: ['yo', 'asignaciones'] }));

    expect(await screen.findByText('¿Con qué banco trabajas hoy?')).toBeInTheDocument();
    expect(screen.queryByText(/Trabajando en/)).toBeNull();
  });

  it('volver sin elegir otro deja la caché del banco', async () => {
    const { cliente } = montar([armenia, manizales]);
    await elegir('Banco de Armenia');
    cliente.setQueryData(['bodegas'], [{ nombre: 'Bodega de Armenia' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Otro banco' }));
    fireEvent.click(screen.getByRole('button', { name: /Seguir en Banco de Armenia/ }));

    expect(screen.getByText(`Trabajando en ${bancoA}`)).toBeInTheDocument();
    expect(cliente.getQueryData(['bodegas'])).toHaveLength(1);
  });
});
