import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Inicio } from './Inicio.tsx';

describe('Inicio', () => {
  it('avisa que lo registrado se sincroniza cuando no hay señal', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

    render(<Inicio />);

    expect(screen.getByText(/Sin señal/)).toBeInTheDocument();
  });

  it('indica que hay señal cuando el navegador está en línea', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);

    render(<Inicio />);

    expect(screen.getByText('Con señal')).toBeInTheDocument();
  });
});
