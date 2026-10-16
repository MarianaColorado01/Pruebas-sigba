import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAVE_DE_INVITACION, PaginaInvitacion } from './PaginaInvitacion.tsx';

const auth0 = vi.hoisted(() => ({
  isAuthenticated: false,
  isLoading: false,
  loginWithRedirect: vi.fn(),
  getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token'),
}));

vi.mock('@auth0/auth0-react', () => ({ useAuth0: () => auth0 }));

const token = 'k'.repeat(43);
const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function abrir(ruta: string) {
  const enrutador = createMemoryRouter(
    [{ path: '/invitacion/:token?', element: <PaginaInvitacion /> }],
    { initialEntries: [ruta] },
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={enrutador} />
    </QueryClientProvider>,
  );
  return enrutador;
}

const responder = (estado: number, cuerpo: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(cuerpo), { status: estado }));

beforeEach(() => {
  auth0.isAuthenticated = false;
  auth0.loginWithRedirect.mockClear();
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('PaginaInvitacion sin sesión', () => {
  it('guarda el token, lo quita de la URL y ofrece crear cuenta', async () => {
    const enrutador = abrir(`/invitacion/${token}`);

    expect(
      await screen.findByRole('heading', { name: 'Te invitaron a SIGBA' }),
    ).toBeInTheDocument();
    expect(sessionStorage.getItem(CLAVE_DE_INVITACION)).toBe(token);
    expect(enrutador.state.location.pathname).toBe('/invitacion');
  });

  it('crear cuenta abre el registro de Auth0 y vuelve a la invitación', async () => {
    abrir(`/invitacion/${token}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Crear mi cuenta' }));

    expect(auth0.loginWithRedirect).toHaveBeenCalledWith({
      appState: { returnTo: '/invitacion' },
      authorizationParams: { screen_hint: 'signup' },
    });
  });

  it('sin token guardado no ofrece nada que aceptar', () => {
    abrir('/invitacion');

    expect(screen.getByRole('heading', { name: 'No hay invitación abierta' })).toBeInTheDocument();
  });
});

describe('PaginaInvitacion con sesión', () => {
  beforeEach(() => {
    auth0.isAuthenticated = true;
    sessionStorage.setItem(CLAVE_DE_INVITACION, token);
  });

  it('acepta, dice con qué rol entra y borra el token', async () => {
    const fetch = responder(200, { bancoId: bancoA, rol: 'operario_bodega' });

    abrir('/invitacion');

    expect(await screen.findByText(/como Operario de bodega/)).toBeInTheDocument();
    expect(sessionStorage.getItem(CLAVE_DE_INVITACION)).toBeNull();
    const [url, opciones] = fetch.mock.calls[0]!;
    expect(String(url)).toMatch(/\/invitaciones\/aceptar$/);
    expect(opciones?.body).toBe(JSON.stringify({ token }));
  });

  it('un enlace usado muestra el motivo de la API y borra el token', async () => {
    responder(410, { codigo: 'usada', message: 'Este enlace ya se usó.' });

    abrir('/invitacion');

    expect(await screen.findByRole('alert')).toHaveTextContent('Este enlace ya se usó.');
    expect(sessionStorage.getItem(CLAVE_DE_INVITACION)).toBeNull();
  });

  it('un correo que no coincide da 403, lo explica y conserva el token para otra cuenta', async () => {
    responder(403, {
      codigo: 'correo_no_coincide',
      message: 'Esta invitación es para otro correo.',
    });

    abrir('/invitacion');

    expect(await screen.findByRole('alert')).toHaveTextContent('para otro correo');
    expect(screen.getByRole('heading')).toHaveTextContent(
      'No podemos darte acceso con esta cuenta',
    );
    expect(sessionStorage.getItem(CLAVE_DE_INVITACION)).toBe(token);
  });

  it('sin respuesta de la API conserva el token para reintentar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    abrir('/invitacion');

    expect(await screen.findByRole('button', { name: 'Intentar de nuevo' })).toBeInTheDocument();
    expect(sessionStorage.getItem(CLAVE_DE_INVITACION)).toBe(token);
  });
});
