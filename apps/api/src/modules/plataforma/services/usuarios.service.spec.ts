import { describe, expect, it, vi } from 'vitest';
import { runWithTenantContext } from '../../../core/index.js';
import type { FilaDeAsignacion } from './usuario.js';
import { UsuariosService } from './usuarios.service.js';

const usuarioId = '11111111-1111-4111-8111-111111111111';
const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bancoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const identidad = {
  emisor: 'https://sigba-synthetic.us.auth0.com/',
  auth0Sub: 'auth0|synthetic-user',
};

function servicioCon({ id, filas = [] }: { id?: string; filas?: FilaDeAsignacion[] }) {
  const idPorIdentidad = vi.fn().mockResolvedValue(id);
  const asignacionesActivas = vi.fn().mockResolvedValue(filas);
  return {
    servicio: new UsuariosService({ idPorIdentidad, asignacionesActivas }),
    idPorIdentidad,
    asignacionesActivas,
  };
}

const fila = (
  rol: string,
  bancoId: string | null,
  bancoNombre: string | null,
  institucionId: string | null = null,
): FilaDeAsignacion => ({ rol, bancoId, bancoNombre, institucionId });

describe('UsuariosService.resolverIdentidad', () => {
  it('resuelve el usuario identificado por issuer y sub', async () => {
    const { servicio, idPorIdentidad } = servicioCon({ id: usuarioId });

    await expect(servicio.resolverIdentidad(identidad)).resolves.toEqual({ usuarioId });
    expect(idPorIdentidad).toHaveBeenCalledWith(identidad);
  });

  it('no resuelve una identidad desconocida o inactiva', async () => {
    const { servicio } = servicioCon({});

    await expect(servicio.resolverIdentidad(identidad)).resolves.toBeUndefined();
  });
});

describe('UsuariosService.asignacionesPropias', () => {
  it('lee las asignaciones del usuario de la sesión', async () => {
    const { servicio, asignacionesActivas } = servicioCon({
      filas: [fila('admin_banco', bancoA, 'Banco de Pereira')],
    });

    const asignaciones = await runWithTenantContext({ usuarioId }, () =>
      servicio.asignacionesPropias(),
    );

    expect(asignacionesActivas).toHaveBeenCalledWith(usuarioId);
    expect(asignaciones).toEqual([
      { rol: 'admin_banco', bancoId: bancoA, bancoNombre: 'Banco de Pereira', institucionId: null },
    ]);
  });

  it('sin usuario en SIGBA responde vacío sin consultar', async () => {
    const { servicio, asignacionesActivas } = servicioCon({});

    await expect(runWithTenantContext({}, () => servicio.asignacionesPropias())).resolves.toEqual(
      [],
    );
    await expect(servicio.asignacionesPropias()).resolves.toEqual([]);
    expect(asignacionesActivas).not.toHaveBeenCalled();
  });

  it('descarta un rol que no está en el contrato', async () => {
    const { servicio } = servicioCon({
      filas: [fila('rol_retirado', bancoA, 'Banco A'), fila('consulta', bancoA, 'Banco A')],
    });

    const asignaciones = await runWithTenantContext({ usuarioId }, () =>
      servicio.asignacionesPropias(),
    );

    expect(asignaciones.map((a) => a.rol)).toEqual(['consulta']);
  });

  it('ordena la red primero, después por banco y dentro del banco por precedencia', async () => {
    const { servicio } = servicioCon({
      filas: [
        fila('consulta', bancoB, 'Banco de Manizales'),
        fila('consulta', bancoA, 'Banco de Armenia'),
        fila('admin_banco', bancoA, 'Banco de Armenia'),
        fila('super_admin', null, null),
      ],
    });

    const asignaciones = await runWithTenantContext({ usuarioId }, () =>
      servicio.asignacionesPropias(),
    );

    expect(asignaciones.map((a) => [a.rol, a.bancoNombre])).toEqual([
      ['super_admin', null],
      ['admin_banco', 'Banco de Armenia'],
      ['consulta', 'Banco de Armenia'],
      ['consulta', 'Banco de Manizales'],
    ]);
  });
});
