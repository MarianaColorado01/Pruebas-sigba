import type { PaginaDeAuditoria } from '@sigba/shared-types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext } from '@/shared/sesion.ts';
import { PantallaDeAuditoria } from './PantallaDeAuditoria.tsx';

// El primer render carga React Query y el router; con la máquina ocupada
// tarda más del segundo que `findBy` espera por defecto.
const ESPERA = { timeout: 3000 };

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({
    getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-access-token'),
  }),
}));

const banco = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const pagina: PaginaDeAuditoria = {
  registros: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      ocurridoEn: new Date(2026, 9, 14, 16, 5).toISOString(),
      tipoActor: 'usuario',
      actorId: '22222222-2222-4222-8222-222222222222',
      actorNombre: 'Marta Coordinadora',
      actorEtiqueta: null,
      accion: 'leer',
      entidad: 'beneficiario',
      entidadId: 'beneficiarios_de_institucion:33333333-3333-4333-8333-333333333333',
      resultado: 'ok',
      finalidad: 'entrega_de_mercado',
      detalle: { cantidad: 12 },
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      ocurridoEn: new Date(2026, 9, 13, 2, 0).toISOString(),
      tipoActor: 'sistema',
      actorId: null,
      actorNombre: null,
      actorEtiqueta: 'sistema:retencion',
      accion: 'actualizar',
      entidad: 'lote',
      entidadId: '55555555-5555-4555-8555-555555555555',
      resultado: 'ok',
      finalidad: null,
      detalle: null,
    },
  ],
  siguienteCursor: null,
};

function montar(rol: AsignacionActiva['rol'], ruta = '/plataforma/auditoria') {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(pagina), { headers: { 'content-type': 'application/json' } }),
  );
  const clienteDeConsultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={clienteDeConsultas}>
      <SesionContext value={{ rol, bancoId: banco, institucionId: null }}>
        <MemoryRouter initialEntries={[ruta]}>{children}</MemoryRouter>
      </SesionContext>
    </QueryClientProvider>
  );
  return render(<PantallaDeAuditoria />, { wrapper: envoltorio });
}

describe('PantallaDeAuditoria', () => {
  afterEach(() => vi.restoreAllMocks());

  it('agrupa por día y distingue a la persona de la tarea del sistema', async () => {
    montar('coordinacion');

    const lectura = await screen.findByRole(
      'button',
      { name: /Marta Coordinadora consultó 12/ },
      ESPERA,
    );
    const delDia = lectura.closest('section');
    expect(delDia).not.toBeNull();
    expect(within(delDia as HTMLElement).queryByText(/Sistema · retencion/)).toBeNull();
    expect(
      screen.getByRole('button', { name: /Sistema · retencion actualizó lote/ }),
    ).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(2);
  });

  it('muestra exportar a admin_banco y no a coordinación', async () => {
    const { unmount } = montar('admin_banco');
    await screen.findByText(/Marta Coordinadora/, {}, ESPERA);
    expect(screen.getByRole('button', { name: /Exportar periodo/ })).toBeDisabled();
    unmount();

    montar('coordinacion', '/plataforma/auditoria?desde=2026-10-01&hasta=2026-10-31');
    await screen.findByText(/Marta Coordinadora/, {}, ESPERA);
    expect(screen.queryByRole('button', { name: /Exportar periodo/ })).toBeNull();
  });

  it('abre el detalle con el conjunto leído y filtra por ese actor', async () => {
    montar('admin_banco');

    fireEvent.click(
      await screen.findByRole('button', { name: /Marta Coordinadora consultó/ }, ESPERA),
    );
    const detalle = screen.getByRole('complementary', { name: 'Detalle del registro' });
    expect(within(detalle).getByText(/beneficiarios_de_institucion:3333/)).toBeVisible();

    fireEvent.click(within(detalle).getByRole('button', { name: 'Solo este actor' }));

    expect(screen.queryByRole('complementary', { name: 'Detalle del registro' })).toBeNull();
    await waitFor(() =>
      expect(String(vi.mocked(fetch).mock.calls.at(-1)?.[0])).toContain(
        'actor=22222222-2222-4222-8222-222222222222',
      ),
    );
  });
});
