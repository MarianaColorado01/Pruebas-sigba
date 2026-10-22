import type { AsignacionDeUsuario } from '@sigba/shared-types';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ColaContext } from '@/offline/cola.ts';
import type { ComandoEnCola } from '@/offline/colaDb.ts';
import { SesionContext } from '@/shared/sesion.ts';
import { BancoActivoContext } from './sesionActiva.ts';
import { Shell } from './Shell.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ logout: vi.fn() }),
}));

const adminArmenia: AsignacionDeUsuario = {
  rol: 'admin_banco',
  bancoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bancoNombre: 'Banco de Armenia',
  institucionId: null,
};
const superAdmin: AsignacionDeUsuario = {
  rol: 'super_admin',
  bancoId: null,
  bancoNombre: null,
  institucionId: null,
};

function montar(activa: AsignacionDeUsuario, opciones = [activa], cambiar = vi.fn()) {
  const enrutador = createMemoryRouter(
    [
      {
        element: (
          <SesionContext value={activa}>
            <BancoActivoContext value={{ activa, opciones, cambiar }}>
              <Shell />
            </BancoActivoContext>
          </SesionContext>
        ),
        children: [{ index: true, element: <p>Pantalla de inicio</p> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={enrutador} />);
  return { cambiar };
}

/** La barra lateral y la inferior traen los mismos destinos; el CSS esconde una. */
const destinos = () => [
  ...new Set(screen.getAllByRole('link').map((enlace) => enlace.textContent)),
];

describe('Shell', () => {
  it('muestra la pantalla de la ruta', () => {
    montar(adminArmenia);

    expect(screen.getByText('Pantalla de inicio')).toBeInTheDocument();
  });

  it('a admin_banco le muestra bodegas y usuarios, y no bancos', () => {
    montar(adminArmenia);

    expect(destinos()).toEqual(['Inicio', 'Bodegas', 'Usuarios']);
    expect(screen.getAllByRole('link', { name: 'Bodegas' })[0]).toHaveAttribute(
      'href',
      '/plataforma/bodegas',
    );
  });

  it('a super_admin le muestra bancos, y no lo de un banco', () => {
    montar(superAdmin);

    expect(destinos()).toEqual(['Inicio', 'Bancos']);
    expect(screen.getAllByText('Toda la red')[0]).toBeInTheDocument();
  });

  it('a un rol sin administración solo le muestra inicio', () => {
    montar({ ...adminArmenia, rol: 'operario_bodega' });

    expect(destinos()).toEqual(['Inicio']);
  });

  it('marca el destino actual', () => {
    montar(adminArmenia);

    for (const inicio of screen.getAllByRole('link', { name: 'Inicio' })) {
      expect(inicio).toHaveAttribute('aria-current', 'page');
    }
  });

  it('con un solo banco no ofrece cambiarlo', () => {
    montar(adminArmenia);

    expect(screen.queryByRole('button', { name: /Cambiar de banco/ })).toBeNull();
  });

  it('con varios bancos el nombre del banco abre el selector', () => {
    const { cambiar } = montar(adminArmenia, [adminArmenia, superAdmin]);

    fireEvent.click(screen.getAllByRole('button', { name: /Cambiar de banco/ })[0]!);

    expect(cambiar).toHaveBeenCalledOnce();
  });

  it('avisa cuántos registros faltan por sincronizar y cuántos están en conflicto', () => {
    const comando = (comandoId: string, estado: ComandoEnCola['estado']): ComandoEnCola => ({
      comandoId,
      bancoId: adminArmenia.bancoId!,
      usuario: 'auth0|operario-sintetico',
      tipo: 'recepcion',
      carga: {},
      estado,
      creadoEn: '2026-10-21T15:00:00.000Z',
      intentos: 0,
      proximoIntento: 0,
    });
    const enrutador = createMemoryRouter([
      {
        element: (
          <ColaContext
            value={{
              comandos: [
                comando('c1', 'pendiente'),
                comando('c2', 'enviado'),
                comando('c3', 'conflicto'),
                comando('c4', 'confirmado'),
              ],
              encolar: vi.fn(),
              sincronizarAhora: vi.fn(),
            }}
          >
            <SesionContext value={adminArmenia}>
              <BancoActivoContext
                value={{ activa: adminArmenia, opciones: [adminArmenia], cambiar: vi.fn() }}
              >
                <Shell />
              </BancoActivoContext>
            </SesionContext>
          </ColaContext>
        ),
        children: [{ index: true, element: null }],
      },
    ]);
    render(<RouterProvider router={enrutador} />);

    expect(
      screen.getAllByRole('link', { name: '2 por sincronizar · 1 en conflicto' })[0],
    ).toHaveAttribute('href', '/sincronizacion');
  });
});
