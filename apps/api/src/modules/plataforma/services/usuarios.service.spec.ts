import { describe, expect, it, vi } from 'vitest';
import { UsuariosService } from './usuarios.service.js';

const usuarioId = '11111111-1111-4111-8111-111111111111';
const identidad = {
  emisor: 'https://sigba-synthetic.us.auth0.com/',
  auth0Sub: 'auth0|synthetic-user',
};

function servicioCon(resultado: string | undefined) {
  const idPorIdentidad = vi.fn().mockResolvedValue(resultado);
  return { servicio: new UsuariosService({ idPorIdentidad }), idPorIdentidad };
}

describe('UsuariosService.resolverIdentidad', () => {
  it('resuelve el usuario identificado por issuer y sub', async () => {
    const { servicio, idPorIdentidad } = servicioCon(usuarioId);

    await expect(servicio.resolverIdentidad(identidad)).resolves.toEqual({ usuarioId });
    expect(idPorIdentidad).toHaveBeenCalledWith(identidad);
  });

  it('no resuelve una identidad desconocida o inactiva', async () => {
    const { servicio } = servicioCon(undefined);

    await expect(servicio.resolverIdentidad(identidad)).resolves.toBeUndefined();
  });
});
