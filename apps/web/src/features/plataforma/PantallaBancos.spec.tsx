import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BancoDto } from '@sigba/shared-types';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext } from '@/shared/sesion';
import { PantallaBancos } from './PantallaBancos.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-token') }),
}));

const superAdmin: AsignacionActiva = { rol: 'super_admin', bancoId: null, institucionId: null };
const pereira: BancoDto = { id: 'k-1', nombre: 'Banco sintético', codigo: 'SINT', activo: true };

/** Una respuesta nueva por llamada: el cuerpo de un `Response` se lee una sola vez. */
const lista = () => new Response(JSON.stringify([pereira]));

function montar(asignacion: AsignacionActiva) {
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltura = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={consultas}>
      <SesionContext value={asignacion}>{children}</SesionContext>
    </QueryClientProvider>
  );
  return render(<PantallaBancos />, { wrapper: envoltura });
}

describe('PantallaBancos', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lista los bancos con el código delante', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => lista());

    montar(superAdmin);

    expect(await screen.findByText('SINT')).toBeInTheDocument();
    expect(screen.getByText('1 en operación')).toBeInTheDocument();
  });

  it('crea un banco con el código en mayúsculas', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, opciones) =>
        opciones?.method === 'POST'
          ? new Response(JSON.stringify({ ...pereira, id: 'k-2' }), { status: 201 })
          : lista(),
      );
    montar(superAdmin);

    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo banco' }));
    fireEvent.change(screen.getByLabelText('Código del banco'), { target: { value: ' bap ' } });
    fireEvent.change(screen.getByLabelText('Nombre del banco'), {
      target: { value: 'Banco de Pereira' },
    });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuevo banco' }));

    await waitFor(() => {
      const post = fetch.mock.calls.find(([, opciones]) => opciones?.method === 'POST');
      expect(post?.[1]?.body).toBe(JSON.stringify({ codigo: 'BAP', nombre: 'Banco de Pereira' }));
    });
  });

  it('no deja enviar un código con espacios por dentro', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => lista());
    montar(superAdmin);

    fireEvent.click(await screen.findByRole('button', { name: 'Nuevo banco' }));
    fireEvent.change(screen.getByLabelText('Código del banco'), { target: { value: 'B A P' } });
    fireEvent.change(screen.getByLabelText('Nombre del banco'), { target: { value: 'Banco' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nuevo banco' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/código/);
    expect(fetch.mock.calls.some(([, opciones]) => opciones?.method === 'POST')).toBe(false);
  });

  it('otro rol no ve la lista ni la pide', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');

    montar({ rol: 'admin_banco', bancoId: 'k-1', institucionId: null });

    expect(screen.getByText(/Tu rol no tiene acceso/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
