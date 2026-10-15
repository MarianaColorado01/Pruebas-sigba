import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Inicio } from './Inicio.tsx';

describe('Inicio', () => {
  it('avisa que lo registrado se sincroniza cuando no hay señal', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    render(
      <MemoryRouter>
        <Inicio />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/Sin señal/);
  });

  it('indica que hay señal cuando el navegador está en línea', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    render(
      <MemoryRouter>
        <Inicio />
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('Con señal');
  });
});
