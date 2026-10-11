import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderAuth0 } from './auth0.tsx';

describe('ProviderAuth0', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sin client ID avisa qué configurar en vez de romper la PWA', () => {
    vi.stubEnv('VITE_AUTH0_CLIENT_ID', '');

    render(
      <ProviderAuth0>
        <p>Contenido</p>
      </ProviderAuth0>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Falta configurar Auth0');
    expect(screen.queryByText('Contenido')).toBeNull();
  });
});
