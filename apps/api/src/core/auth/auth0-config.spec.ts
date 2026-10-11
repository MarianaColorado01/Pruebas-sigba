import { describe, expect, it } from 'vitest';
import { cargarConfiguracionAuth0 } from './auth0-config.js';

const configuracion = {
  AUTH0_ISSUER_URL: 'https://sigba-synthetic.us.auth0.com/',
  AUTH0_AUDIENCE: 'https://api.sigba.synthetic',
};

describe('cargarConfiguracionAuth0', () => {
  it.each(['AUTH0_ISSUER_URL', 'AUTH0_AUDIENCE'] as const)('falla si falta %s', (variable) => {
    const entorno = { ...configuracion };
    delete entorno[variable];

    expect(() => cargarConfiguracionAuth0(entorno)).toThrow();
  });

  it('deriva el JWKS del issuer', () => {
    expect(cargarConfiguracionAuth0(configuracion)).toEqual({
      issuer: configuracion.AUTH0_ISSUER_URL,
      audience: configuracion.AUTH0_AUDIENCE,
      jwksUri: 'https://sigba-synthetic.us.auth0.com/.well-known/jwks.json',
    });
  });

  it('añade la barra final que Auth0 pone en iss', () => {
    const { issuer, jwksUri } = cargarConfiguracionAuth0({
      ...configuracion,
      AUTH0_ISSUER_URL: 'https://sigba-synthetic.us.auth0.com',
    });

    expect(issuer).toBe('https://sigba-synthetic.us.auth0.com/');
    expect(jwksUri).toBe('https://sigba-synthetic.us.auth0.com/.well-known/jwks.json');
  });

  it.each(['http://auth.local/', 'https://usuario:clave@auth.local/', 'no es una url'])(
    'rechaza el issuer %s',
    (issuer) => {
      expect(() =>
        cargarConfiguracionAuth0({ ...configuracion, AUTH0_ISSUER_URL: issuer }),
      ).toThrow();
    },
  );
});
