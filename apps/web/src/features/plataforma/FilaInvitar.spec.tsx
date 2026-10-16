import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilaInvitar } from './FilaInvitar.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token') }),
}));

const enlace = 'https://sigba.example/invitacion/abc';

function emitir(correoEnviado: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        invitacionId: 'i',
        enlace,
        venceEn: '2026-10-22T15:00:00.000Z',
        correoEnviado,
        yaExistia: false,
      }),
      { status: 201 },
    ),
  );
}

async function invitar() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ul>
        <FilaInvitar />
      </ul>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Invitar a alguien' }));
  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Ruiz' } });
  fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ana@example.invalid' } });
  fireEvent.click(screen.getByLabelText('Coordinación'));
  fireEvent.click(screen.getByRole('button', { name: 'Crear invitación' }));
  await screen.findByText(enlace);
}

afterEach(() => vi.restoreAllMocks());

describe('FilaInvitar', () => {
  it('crea la invitación en la misma fila y muestra el enlace para copiar', async () => {
    const fetch = emitir(false);

    await invitar();

    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({
      nombre: 'Ana Ruiz',
      email: 'ana@example.invalid',
      rol: 'coordinacion',
    });
    expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No salió correo');
  });

  it('si ya había una pendiente no muestra enlace y manda a reenviar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          invitacionId: 'i',
          enlace: null,
          venceEn: '2026-10-22T15:00:00.000Z',
          correoEnviado: false,
          yaExistia: true,
        }),
        { status: 200 },
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ul>
          <FilaInvitar />
        </ul>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Invitar a alguien' }));
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Ana Ruiz' } });
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'ana@example.invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear invitación' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Ya había una invitación pendiente para ana@example.invalid',
    );
    expect(screen.queryByRole('button', { name: 'Copiar enlace' })).not.toBeInTheDocument();
  });

  it('avisa cuando además salió el correo', async () => {
    emitir(true);

    await invitar();

    expect(screen.getByRole('status')).toHaveTextContent(
      'También salió un correo a ana@example.invalid',
    );
  });
});
