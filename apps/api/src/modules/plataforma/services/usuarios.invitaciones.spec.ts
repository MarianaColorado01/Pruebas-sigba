import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { EnviadorDeCorreo, runWithTenantContext, type TenantContext } from '../../../core/index.js';
import {
  BancoInexistente,
  InvitacionesRepositorio,
  type NuevaInvitacion,
  PendienteConOtrosDatos,
} from './invitacion.js';
import { UsuariosRepositorio } from './usuario.js';
import { UsuariosService } from './usuarios.service.js';

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bancoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const admin = '11111111-1111-4111-8111-111111111111';
const otra = '22222222-2222-4222-8222-222222222222';
const invitacionId = '33333333-3333-4333-8333-333333333333';
const institucionX = '44444444-4444-4444-8444-444444444444';
const emisor = 'https://sigba-synthetic.us.auth0.com/';
/** Cuenta con el correo verificado en el token, la única que puede aceptar. */
const identidad = {
  emisor,
  auth0Sub: 'auth0|nueva',
  email: 'ana@example.invalid',
  emailVerificado: true,
};
const origenDeLaPwa = 'https://sigba.example';
const destino = { email: 'ana@example.invalid', nombre: 'Ana Ruiz', bancoNombre: 'Banco A' };

const comoAdmin: TenantContext = { usuarioId: admin, bancoId: bancoA, rol: 'admin_banco' };
const comoSuperAdmin: TenantContext = { usuarioId: admin, rol: 'super_admin' };

function falsos() {
  const invitaciones = {
    crear: vi.fn().mockResolvedValue({
      id: invitacionId,
      bancoNombre: 'Banco A',
      venceEn: new Date('2026-10-22T15:00:00Z'),
      yaExistia: false,
    }),
    listar: vi.fn().mockResolvedValue([]),
    renovarToken: vi.fn().mockResolvedValue(destino),
    revocar: vi.fn().mockResolvedValue(destino),
    aceptar: vi.fn(),
  };
  const usuarios = {
    idPorIdentidad: vi.fn(),
    asignacionesActivas: vi.fn(),
    delBanco: vi.fn().mockResolvedValue([]),
    desactivarAsignaciones: vi.fn().mockResolvedValue(1),
  };
  const correo = { enviar: vi.fn().mockResolvedValue(false) };
  const servicio = new UsuariosService(
    usuarios as unknown as UsuariosRepositorio,
    invitaciones as unknown as InvitacionesRepositorio,
    correo as unknown as EnviadorDeCorreo,
    origenDeLaPwa,
  );
  return { servicio, invitaciones, usuarios, correo };
}

const nueva = {
  email: '  Ana@Example.Invalid ',
  nombre: ' Ana   Ruiz ',
  rol: 'coordinacion' as const,
};

describe('UsuariosService.invitar (D4, D9)', () => {
  it('guarda solo el hash del token y devuelve el enlace con ese token', async () => {
    const { servicio, invitaciones } = falsos();

    const emitida = await runWithTenantContext(comoAdmin, () =>
      servicio.invitar({ ...nueva, bancoId: bancoA }),
    );

    const guardada = invitaciones.crear.mock.calls[0]![0] as NuevaInvitacion;
    const token = emitida.enlace!.replace('https://sigba.example/invitacion/', '');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(guardada.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(guardada)).not.toContain(token);
    expect(guardada).toMatchObject({
      bancoId: bancoA,
      email: 'ana@example.invalid',
      nombre: 'Ana Ruiz',
      rol: 'coordinacion',
      institucionId: null,
    });
    expect(emitida.invitacionId).toBe(invitacionId);
  });

  it('el enlace vence a los 7 días', async () => {
    const { servicio } = falsos();
    const antes = Date.now();

    const { venceEn } = await runWithTenantContext(comoAdmin, () =>
      servicio.invitar({ ...nueva, bancoId: bancoA }),
    );

    const dias = (venceEn.getTime() - antes) / 86_400_000;
    expect(dias).toBeGreaterThanOrEqual(7);
    expect(dias).toBeLessThan(7.01);
  });

  it('dos invitaciones no comparten token', async () => {
    const { servicio } = falsos();
    const invitar = () =>
      runWithTenantContext(comoAdmin, () => servicio.invitar({ ...nueva, bancoId: bancoA }));

    const [a, b] = await Promise.all([invitar(), invitar()]);

    expect(a.enlace).not.toBe(b.enlace);
  });

  it('manda el enlace por correo y dice si salió', async () => {
    const { servicio, correo } = falsos();
    correo.enviar.mockResolvedValue(true);

    const emitida = await runWithTenantContext(comoAdmin, () =>
      servicio.invitar({ ...nueva, bancoId: bancoA }),
    );

    expect(emitida.correoEnviado).toBe(true);
    expect(correo.enviar).toHaveBeenCalledWith(
      expect.objectContaining({ para: 'ana@example.invalid' }),
    );
    expect(correo.enviar.mock.calls[0]![0].texto).toContain(emitida.enlace!);
  });

  it('sin correo configurado igual entrega el enlace', async () => {
    const { servicio } = falsos();

    const emitida = await runWithTenantContext(comoAdmin, () =>
      servicio.invitar({ ...nueva, bancoId: bancoA }),
    );

    expect(emitida.correoEnviado).toBe(false);
    expect(emitida.yaExistia).toBe(false);
    expect(emitida.enlace!).toMatch(/^https:\/\/sigba\.example\/invitacion\//);
  });

  it('si ya había una pendiente igual devuelve esa, sin enlace ni correo', async () => {
    const { servicio, invitaciones, correo } = falsos();
    const venceEn = new Date('2026-10-20T10:00:00Z');
    invitaciones.crear.mockResolvedValue({
      id: invitacionId,
      bancoNombre: 'Banco A',
      venceEn,
      yaExistia: true,
    });

    const emitida = await runWithTenantContext(comoAdmin, () =>
      servicio.invitar({ ...nueva, bancoId: bancoA }),
    );

    expect(emitida).toEqual({
      invitacionId,
      enlace: null,
      venceEn,
      correoEnviado: false,
      yaExistia: true,
    });
    expect(correo.enviar).not.toHaveBeenCalled();
  });

  it('una pendiente con otro rol o institución da 409 y no manda correo', async () => {
    const { servicio, invitaciones, correo } = falsos();
    invitaciones.crear.mockRejectedValue(new PendienteConOtrosDatos());

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.invitar({ ...nueva, bancoId: bancoA })),
    ).rejects.toThrow(ConflictException);
    expect(correo.enviar).not.toHaveBeenCalled();
  });

  it('con banco en el contexto no invita a otro banco', async () => {
    const { servicio, invitaciones } = falsos();

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.invitar({ ...nueva, bancoId: bancoB })),
    ).rejects.toThrow(ForbiddenException);
    expect(invitaciones.crear).not.toHaveBeenCalled();
  });

  it('super_admin invita al banco que recibe', async () => {
    const { servicio, invitaciones } = falsos();

    await runWithTenantContext(comoSuperAdmin, () =>
      servicio.invitar({ ...nueva, rol: 'admin_banco', bancoId: bancoB }),
    );

    expect(invitaciones.crear.mock.calls[0]![0]).toMatchObject({ bancoId: bancoB });
  });

  it('un banco que no existe da 404', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.crear.mockRejectedValue(new BancoInexistente());

    await expect(
      runWithTenantContext(comoSuperAdmin, () => servicio.invitar({ ...nueva, bancoId: bancoB })),
    ).rejects.toThrow(NotFoundException);
  });

  it('otro error del repositorio no se traduce', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.crear.mockRejectedValue(new Error('se cayó la base'));

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.invitar({ ...nueva, bancoId: bancoA })),
    ).rejects.toThrow('se cayó la base');
  });

  it.each([
    ['correo sin arroba', { email: 'ana.example.invalid' }],
    ['correo de más de 200', { email: `${'a'.repeat(195)}@x.invalid` }],
    ['nombre vacío', { nombre: '   ' }],
    ['nombre de más de 200', { nombre: 'a'.repeat(201) }],
    ['super_admin', { rol: 'super_admin' as const }],
    ['institución sin su institución', { rol: 'institucion' as const }],
    ['rol interno con institución', { institucionId: institucionX }],
  ])('rechaza %s con 400', async (_caso, cambio) => {
    const { servicio, invitaciones } = falsos();

    await expect(
      runWithTenantContext(comoAdmin, () =>
        servicio.invitar({ ...nueva, bancoId: bancoA, ...cambio }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(invitaciones.crear).not.toHaveBeenCalled();
  });

  it('invita al rol institución con su institución (M2)', async () => {
    const { servicio, invitaciones } = falsos();

    await runWithTenantContext({ ...comoAdmin, rol: 'coordinacion' }, () =>
      servicio.invitar({
        ...nueva,
        rol: 'institucion',
        institucionId: institucionX,
        bancoId: bancoA,
      }),
    );

    expect(invitaciones.crear.mock.calls[0]![0]).toMatchObject({
      rol: 'institucion',
      institucionId: institucionX,
    });
  });
});

describe('UsuariosService.invitarAlBanco (D8)', () => {
  it('usa el banco del contexto', async () => {
    const { servicio, invitaciones } = falsos();

    await runWithTenantContext(comoAdmin, () => servicio.invitarAlBanco(nueva));

    expect(invitaciones.crear.mock.calls[0]![0]).toMatchObject({ bancoId: bancoA });
  });

  it.each(['institucion', 'super_admin'] as const)('rechaza %s con 400', async (rol) => {
    const { servicio } = falsos();

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.invitarAlBanco({ ...nueva, rol })),
    ).rejects.toThrow(BadRequestException);
  });

  it('sin banco en el contexto no invita', async () => {
    const { servicio } = falsos();

    await expect(
      runWithTenantContext(comoSuperAdmin, () => servicio.invitarAlBanco(nueva)),
    ).rejects.toThrow(/sin banco/);
  });
});

describe('UsuariosService.invitacionesDelBanco', () => {
  it('marca vencida la pendiente cuyo enlace pasó y deja el rol del contrato', async () => {
    const { servicio, invitaciones } = falsos();
    const base = {
      email: 'x@example.invalid',
      nombre: 'X',
      creadoEn: new Date(),
      aceptadaPorNombre: null,
    };
    const ayer = new Date(Date.now() - 86_400_000);
    const manana = new Date(Date.now() + 86_400_000);
    invitaciones.listar.mockResolvedValue([
      { ...base, id: '1', rol: 'consulta', venceEn: manana, aceptadaEn: null },
      { ...base, id: '2', rol: 'consulta', venceEn: ayer, aceptadaEn: null },
      { ...base, id: '3', rol: 'voluntario', venceEn: ayer, aceptadaEn: ayer },
      { ...base, id: '4', rol: 'rol_retirado', venceEn: manana, aceptadaEn: null },
    ]);

    const filas = await servicio.invitacionesDelBanco();

    expect(filas.map((f) => [f.id, f.estado])).toEqual([
      ['1', 'pendiente'],
      ['2', 'vencida'],
      ['3', 'aceptada'],
    ]);
  });
});

describe('UsuariosService.reenviar y revocar (D4)', () => {
  it('reenviar guarda otro hash y devuelve el enlace nuevo', async () => {
    const { servicio, invitaciones, correo } = falsos();

    const emitida = await servicio.reenviar(invitacionId);

    const [id, hash] = invitaciones.renovarToken.mock.calls[0]!;
    const token = emitida.enlace!.split('/').pop()!;
    expect(id).toBe(invitacionId);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(correo.enviar).toHaveBeenCalledWith(expect.objectContaining({ para: destino.email }));
  });

  it.each([
    ['no_existe', NotFoundException],
    ['cerrada', ConflictException],
  ] as const)('reenviar una %s responde con su error', async (cambio, error) => {
    const { servicio, invitaciones, correo } = falsos();
    invitaciones.renovarToken.mockResolvedValue(cambio);

    await expect(servicio.reenviar(invitacionId)).rejects.toThrow(error);
    expect(correo.enviar).not.toHaveBeenCalled();
  });

  it('revocar devuelve el id', async () => {
    const { servicio } = falsos();

    await expect(servicio.revocar(invitacionId)).resolves.toEqual({ invitacionId });
  });

  it('revocar una cerrada da 409', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.revocar.mockResolvedValue('cerrada');

    await expect(servicio.revocar(invitacionId)).rejects.toThrow(ConflictException);
  });
});

describe('UsuariosService.aceptar (D2, D5)', () => {
  const token = 'a'.repeat(43);

  it('acepta con el hash del token y devuelve banco y rol', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.aceptar.mockResolvedValue({
      resultado: 'aceptada',
      bancoId: bancoA,
      rol: 'consulta',
    });

    await expect(servicio.aceptar(token, identidad)).resolves.toEqual({
      bancoId: bancoA,
      rol: 'consulta',
    });
    expect(invitaciones.aceptar).toHaveBeenCalledWith(
      createHash('sha256').update(token).digest('hex'),
      identidad,
    );
  });

  it.each(['no_existe', 'vencida', 'usada', 'revocada'] as const)(
    'un enlace %s da 410 con su código',
    async (resultado) => {
      const { servicio, invitaciones } = falsos();
      invitaciones.aceptar.mockResolvedValue({ resultado });

      const error = await servicio.aceptar(token, identidad).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(GoneException);
      expect((error as GoneException).getResponse()).toMatchObject({ codigo: resultado });
    },
  );

  it('un correo de otra cuenta da 409 con su código', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.aceptar.mockResolvedValue({ resultado: 'correo_en_uso' });

    const error = await servicio.aceptar(token, identidad).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ codigo: 'correo_en_uso' });
  });

  it.each([
    ['correo_no_verificado'],
    ['correo_no_coincide'],
    ['usuario_inactivo'],
    ['banco_inactivo'],
  ] as const)('%s da 403 con su código y sin revelar el correo invitado', async (resultado) => {
    const { servicio, invitaciones } = falsos();
    invitaciones.aceptar.mockResolvedValue({ resultado });

    const error = await servicio.aceptar(token, identidad).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    const cuerpo = (error as ForbiddenException).getResponse();
    expect(cuerpo).toMatchObject({ codigo: resultado, statusCode: 403 });
    expect(JSON.stringify(cuerpo)).not.toContain('example.invalid');
  });

  it.each([
    ['sin correo en el token', { emisor, auth0Sub: 'auth0|nueva' }],
    ['con correo sin verificar', { emisor, auth0Sub: 'auth0|nueva', email: 'ana@example.invalid' }],
    [
      'con verificado y sin correo',
      { emisor, auth0Sub: 'auth0|nueva', emailVerificado: true as const },
    ],
  ])('un token %s da 403 correo_no_verificado sin tocar la base', async (_caso, sinPrueba) => {
    const { servicio, invitaciones } = falsos();

    const error = await servicio.aceptar(token, sinPrueba).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      codigo: 'correo_no_verificado',
    });
    expect(invitaciones.aceptar).not.toHaveBeenCalled();
  });

  it('un token con otra forma da 410 sin consultar', async () => {
    const { servicio, invitaciones } = falsos();

    await expect(servicio.aceptar('corto', identidad)).rejects.toThrow(GoneException);
    expect(invitaciones.aceptar).not.toHaveBeenCalled();
  });

  it('el mensaje del 410 no repite el token', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.aceptar.mockResolvedValue({ resultado: 'usada' });

    const error = await servicio.aceptar(token, identidad).catch((e: unknown) => e);

    expect(JSON.stringify((error as GoneException).getResponse())).not.toContain(token);
  });

  it('una aceptada con un rol fuera del contrato es un error del servidor', async () => {
    const { servicio, invitaciones } = falsos();
    invitaciones.aceptar.mockResolvedValue({ resultado: 'aceptada', bancoId: bancoA, rol: 'otro' });

    await expect(servicio.aceptar(token, identidad)).rejects.toThrow(/fuera del contrato/);
  });
});

describe('UsuariosService usuarios del banco (D15)', () => {
  it('lista solo roles del contrato', async () => {
    const { servicio, usuarios } = falsos();
    const base = {
      usuarioId: otra,
      nombre: 'Otra',
      email: 'o@example.invalid',
      institucionId: null,
      desde: new Date(),
    };
    usuarios.delBanco.mockResolvedValue([
      { ...base, rol: 'consulta' },
      { ...base, rol: 'rol_retirado' },
    ]);

    const filas = await servicio.usuariosDelBanco();

    expect(filas.map((f) => f.rol)).toEqual(['consulta']);
  });

  it('desactiva las asignaciones de otra persona en el banco', async () => {
    const { servicio, usuarios } = falsos();
    usuarios.desactivarAsignaciones.mockResolvedValue(2);

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.desactivarAsignacion(otra)),
    ).resolves.toEqual({ usuarioId: otra, desactivadas: 2 });
    expect(usuarios.desactivarAsignaciones).toHaveBeenCalledWith(otra);
  });

  it('un admin_banco puede quitarle el acceso a otro admin_banco', async () => {
    const { servicio, usuarios } = falsos();
    usuarios.delBanco.mockResolvedValue([
      {
        usuarioId: otra,
        nombre: 'Otra Admin',
        email: 'otra@example.invalid',
        rol: 'admin_banco',
        institucionId: null,
        desde: new Date(),
      },
    ]);

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.desactivarAsignacion(otra)),
    ).resolves.toEqual({ usuarioId: otra, desactivadas: 1 });
  });

  it('no deja que la administradora se quite el acceso', async () => {
    const { servicio, usuarios } = falsos();

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.desactivarAsignacion(admin)),
    ).rejects.toThrow(BadRequestException);
    expect(usuarios.desactivarAsignaciones).not.toHaveBeenCalled();
  });

  it('sin asignaciones activas en el banco da 404', async () => {
    const { servicio, usuarios } = falsos();
    usuarios.desactivarAsignaciones.mockResolvedValue(0);

    await expect(
      runWithTenantContext(comoAdmin, () => servicio.desactivarAsignacion(otra)),
    ).rejects.toThrow(NotFoundException);
  });
});
