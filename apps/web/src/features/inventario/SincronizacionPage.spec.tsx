import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColaContext } from '@/offline/cola.ts';
import type { ComandoEnCola } from '@/offline/colaDb.ts';
import { SincronizacionPage } from './SincronizacionPage.tsx';

function comando(datos: Partial<ComandoEnCola> & Pick<ComandoEnCola, 'comandoId'>): ComandoEnCola {
  return {
    bancoId: 'banco-sintetico',
    usuario: 'auth0|operario-sintetico',
    tipo: 'recepcion',
    carga: {},
    estado: 'pendiente',
    creadoEn: '2026-10-21T15:00:00.000Z',
    intentos: 0,
    proximoIntento: 0,
    ...datos,
  };
}

function montar(comandos: ComandoEnCola[]) {
  const sincronizarAhora = vi.fn();
  render(
    <ColaContext value={{ comandos, encolar: vi.fn(), sincronizarAhora }}>
      <SincronizacionPage />
    </ColaContext>,
  );
  return { sincronizarAhora };
}

describe('SincronizacionPage', () => {
  it('muestra los conflictos con el motivo de la API y los pendientes con sus intentos', () => {
    montar([
      comando({
        comandoId: 'c1',
        estado: 'conflicto',
        rechazo: { estado: 409, mensaje: 'Ese comando ya llegó con otra carga.' },
      }),
      comando({ comandoId: 'c2', intentos: 3 }),
      comando({ comandoId: 'c3', estado: 'enviado' }),
      comando({ comandoId: 'c4', estado: 'confirmado' }),
    ]);

    const conflictos = screen.getByRole('region', { name: 'En conflicto (1)' });
    expect(
      within(conflictos).getByText('Ese comando ya llegó con otra carga.'),
    ).toBeInTheDocument();

    const pendientes = screen.getByRole('region', { name: 'Pendientes de sincronizar (2)' });
    expect(
      within(pendientes).getByText('Pendiente de sincronizar · 3 intentos'),
    ).toBeInTheDocument();
    expect(within(pendientes).getByText('Enviando…')).toBeInTheDocument();
  });

  it('envía lo pendiente al pulsar «Sincronizar ahora»', () => {
    const { sincronizarAhora } = montar([comando({ comandoId: 'c1' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar ahora' }));

    expect(sincronizarAhora).toHaveBeenCalled();
  });

  it('sin nada en la cola lo dice', () => {
    montar([comando({ comandoId: 'c1', estado: 'confirmado' })]);

    expect(screen.getByText('Todo lo registrado llegó a la API.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sincronizar ahora' })).not.toBeInTheDocument();
  });
});
