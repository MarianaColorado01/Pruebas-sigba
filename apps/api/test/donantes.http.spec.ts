import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECERAS, type Rol } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarApp } from '../src/configurar-app.js';
import type { UsuarioConAsignaciones } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import { AsignacionesDeUsuario } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import {
  CoreModule,
  GUARDS_GLOBALES,
  PrismaService,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../src/core/index.js';
import { DonantesController } from '../src/modules/inventario/controllers/donantes.controller.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';

/**
 * El directorio de donantes por HTTP (SBA-79), sin base de datos: el servicio
 * es un doble y el token lo «verifica» un verificador falso cuyo `sub` es el
 * propio token. Se prueba lo que pone el controlador: roles, validación de DTO
 * y el 200 cuando el alta ya existía.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const DONANTE_ID = '66666666-6666-4666-8666-666666666666';
const DONANTE = {
  id: DONANTE_ID,
  nombre: 'Parroquia San José',
  tipo: 'parroquia',
  contacto: null,
  activo: true,
};

function conRol(rol: Rol): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
  };
}

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  operario: conRol('operario_bodega'),
  voluntario: conRol('voluntario'),
  coordinacion: conRol('coordinacion'),
  'sin-rol': { usuarioId: '88888888-0000-4000-8000-000000000002', asignaciones: [] },
};

const verificador: TokenVerifier = {
  async verify(token) {
    if (token === 'invalido') throw new Error('firma inválida');
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

describe('HTTP de donantes (SBA-79)', () => {
  let app: INestApplication<Server>;

  const donantes = {
    buscar: vi.fn(),
    darDeAlta: vi.fn(),
    editar: vi.fn(),
    desactivar: vi.fn(),
  };

  function como(sub: string, metodo: 'get' | 'post' | 'patch', ruta: string) {
    return request(app.getHttpServer())
      [metodo](`/api/v1/${ruta}`)
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [DonantesController],
      providers: [...GUARDS_GLOBALES, { provide: DonantesService, useValue: donantes }],
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verificador)
      .overrideProvider(AsignacionesDeUsuario)
      .useValue({ deIdentidad: async (sub: string) => USUARIOS[sub] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = modulo.createNestApplication();
    configurarApp(app, ['http://localhost:5173']);
    await app.init();
  });

  beforeEach(() => {
    donantes.buscar.mockReset().mockResolvedValue([DONANTE]);
    donantes.darDeAlta.mockReset().mockResolvedValue({ donante: DONANTE, repetido: false });
    donantes.editar.mockReset().mockResolvedValue(DONANTE);
    donantes.desactivar.mockReset().mockResolvedValue({ ...DONANTE, activo: false });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('busca por texto y tipo con el booleano ya convertido', async () => {
    const respuesta = await como(
      'voluntario',
      'get',
      'donantes?texto=san&tipo=parroquia&incluirInactivos=true',
    ).expect(200);

    expect(respuesta.body).toEqual([DONANTE]);
    expect(donantes.buscar).toHaveBeenCalledWith({
      texto: 'san',
      tipo: 'parroquia',
      incluirInactivos: true,
    });
  });

  it('responde 400 con un tipo que no existe', async () => {
    await como('operario', 'get', 'donantes?tipo=gobierno').expect(400);
    await como('operario', 'post', 'donantes').send({ nombre: 'X', tipo: 'gobierno' }).expect(400);
    expect(donantes.darDeAlta).not.toHaveBeenCalled();
  });

  it('deja al operario dar de alta con nombre y tipo: 201 la primera vez', async () => {
    const respuesta = await como('operario', 'post', 'donantes')
      .send({ nombre: 'Parroquia San José', tipo: 'parroquia' })
      .expect(201);

    expect(respuesta.body).toEqual(DONANTE);
    expect(donantes.darDeAlta).toHaveBeenCalledWith({
      nombre: 'Parroquia San José',
      tipo: 'parroquia',
    });
  });

  it('responde 200 con el mismo donante si el alta ya existía', async () => {
    donantes.darDeAlta.mockResolvedValue({ donante: DONANTE, repetido: true });

    const respuesta = await como('operario', 'post', 'donantes')
      .send({ nombre: 'Parroquia San José', tipo: 'parroquia' })
      .expect(200);

    expect(respuesta.body).toEqual(DONANTE);
  });

  it('responde 400 sin nombre o con un campo que el DTO no declara', async () => {
    await como('operario', 'post', 'donantes').send({ tipo: 'empresa' }).expect(400);
    await como('operario', 'post', 'donantes')
      .send({ nombre: 'X', tipo: 'empresa', bancoId: BANCO })
      .expect(400);
    expect(donantes.darDeAlta).not.toHaveBeenCalled();
  });

  it('responde 401 sin token y 403 sin rol en el banco', async () => {
    await request(app.getHttpServer()).get('/api/v1/donantes').expect(401);
    await como('sin-rol', 'get', 'donantes').expect(403);
  });

  it('no deja al voluntario dar de alta ni al operario editar o desactivar', async () => {
    await como('voluntario', 'post', 'donantes').send({ nombre: 'X', tipo: 'empresa' }).expect(403);
    await como('operario', 'patch', `donantes/${DONANTE_ID}`).send({ nombre: 'Y' }).expect(403);
    await como('operario', 'post', `donantes/${DONANTE_ID}/desactivar`).expect(403);
    expect(donantes.darDeAlta).not.toHaveBeenCalled();
    expect(donantes.editar).not.toHaveBeenCalled();
    expect(donantes.desactivar).not.toHaveBeenCalled();
  });

  it('deja a coordinación editar y desactivar', async () => {
    await como('coordinacion', 'patch', `donantes/${DONANTE_ID}`)
      .send({ contacto: '300 000 0000' })
      .expect(200);
    const desactivado = await como(
      'coordinacion',
      'post',
      `donantes/${DONANTE_ID}/desactivar`,
    ).expect(201);

    expect(donantes.editar).toHaveBeenCalledWith(DONANTE_ID, { contacto: '300 000 0000' });
    expect(desactivado.body.activo).toBe(false);
  });

  it('responde 400 si el id no es UUID o si el nombre llega nulo al editar', async () => {
    await como('coordinacion', 'patch', 'donantes/no-es-uuid').send({ nombre: 'Y' }).expect(400);
    await como('coordinacion', 'patch', `donantes/${DONANTE_ID}`)
      .send({ nombre: null })
      .expect(400);
    expect(donantes.editar).not.toHaveBeenCalled();
  });
});
