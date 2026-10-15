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
import { ReferenciasController } from '../src/modules/inventario/controllers/referencias.controller.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';

/**
 * El catálogo por HTTP (SBA-22), sin base de datos: el servicio es un doble y
 * el token lo «verifica» un verificador falso cuyo `sub` es el propio token.
 * Lo que se prueba es lo que pone el controlador y la configuración de
 * `main.ts`: ETag y 304, roles, validación de DTO y la cabecera expuesta por
 * CORS.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const VERSION = 'catalogo-v1';

function conRol(rol: Rol): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
  };
}

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  operario: conRol('operario_bodega'),
  coordinacion: conRol('coordinacion'),
  'sin-rol': { usuarioId: '88888888-0000-4000-8000-000000000002', asignaciones: [] },
};

const verificador: TokenVerifier = {
  async verify(token) {
    if (token === 'invalido') throw new Error('firma inválida');
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

describe('HTTP del catálogo (SBA-22)', () => {
  let app: INestApplication<Server>;

  const referencias = {
    buscar: vi.fn(),
    catalogo: vi.fn(),
    crearCategoria: vi.fn(),
    crearDesdeCelular: vi.fn(),
    presentacionesSimilares: vi.fn(),
  };

  const COMANDO = {
    comandoId: '01920000-0000-7000-8000-000000000001',
    productoId: '66666666-6666-4666-8666-666666666666',
    presentacion: '480 g',
    equivalenciaKg: 0.48,
  };

  function como(sub: string, metodo: 'get' | 'post', ruta: string) {
    return request(app.getHttpServer())
      [metodo](`/api/v1/${ruta}`)
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [ReferenciasController],
      providers: [...GUARDS_GLOBALES, { provide: ReferenciasService, useValue: referencias }],
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
    referencias.buscar.mockReset().mockResolvedValue([]);
    referencias.catalogo.mockReset().mockResolvedValue({ version: VERSION, categorias: [] });
    referencias.crearCategoria.mockReset().mockResolvedValue({ id: 'categoria-1' });
    referencias.crearDesdeCelular.mockReset();
    referencias.presentacionesSimilares.mockReset().mockResolvedValue([]);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('responde 304 sin cuerpo si el ETag no cambió', async () => {
    const respuesta = await como('operario', 'get', 'catalogo')
      .set('If-None-Match', VERSION)
      .expect(304);

    expect(respuesta.headers.etag).toBe(`"${VERSION}"`);
    expect(respuesta.text).toBe('');
  });

  it('responde 200 con el catálogo y el ETag nuevo si cambió', async () => {
    referencias.catalogo.mockResolvedValue({ version: 'catalogo-v2', categorias: [{ id: 'c-1' }] });

    const respuesta = await como('operario', 'get', 'catalogo')
      .set('If-None-Match', VERSION)
      .expect(200)
      .expect('ETag', '"catalogo-v2"');

    expect(respuesta.body.categorias).toEqual([{ id: 'c-1' }]);
  });

  it('acepta el ETag con comillas o débil, como lo reenvían los navegadores', async () => {
    await como('operario', 'get', 'catalogo').set('If-None-Match', `W/"${VERSION}"`).expect(304);
  });

  it('expone el ETag por CORS para que la PWA lo lea desde su origen', async () => {
    const respuesta = await como('operario', 'get', 'catalogo')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(respuesta.headers['access-control-expose-headers']).toContain('ETag');
  });

  it('pasa la búsqueda al servicio con el booleano ya convertido', async () => {
    await como('operario', 'get', 'referencias?texto=arr&incluirInactivas=false').expect(200);

    expect(referencias.buscar).toHaveBeenCalledWith({ texto: 'arr', incluirInactivas: false });
  });

  it('responde 401 sin token o con un token inválido', async () => {
    await request(app.getHttpServer()).get('/api/v1/catalogo').expect(401);
    await como('invalido', 'get', 'catalogo').expect(401);
  });

  it('responde 403 sin rol en el banco y si un operario intenta crear', async () => {
    await como('sin-rol', 'get', 'catalogo').expect(403);
    await como('operario', 'post', 'categorias').send({ nombre: 'Cereales' }).expect(403);
    expect(referencias.crearCategoria).not.toHaveBeenCalled();
  });

  it('responde 400 con un DTO inválido o con un campo que el DTO no declara', async () => {
    await como('operario', 'get', 'referencias?categoriaId=incorrecto').expect(400);
    await como('coordinacion', 'post', 'categorias')
      .send({ nombre: 'Cereales', creadaDesdeCelular: true })
      .expect(400);
  });

  it('deja crear una categoría a coordinación', async () => {
    await como('coordinacion', 'post', 'categorias').send({ nombre: 'Cereales' }).expect(201);

    expect(referencias.crearCategoria).toHaveBeenCalledWith({ nombre: 'Cereales' });
  });

  describe('alta desde el celular (SBA-23)', () => {
    it('responde 201 la primera vez y 200 con lo mismo si el celular reenvía', async () => {
      const referencia = { id: 'referencia-1', presentacion: '480 g' };
      referencias.crearDesdeCelular
        .mockResolvedValueOnce({ referencia, repetida: false })
        .mockResolvedValueOnce({ referencia, repetida: true });

      const primera = await como('operario', 'post', 'referencias/desde-celular')
        .send(COMANDO)
        .expect(201);
      const segunda = await como('operario', 'post', 'referencias/desde-celular')
        .send(COMANDO)
        .expect(200);

      expect(primera.body).toEqual(referencia);
      expect(segunda.body).toEqual(referencia);
      expect(referencias.crearDesdeCelular).toHaveBeenCalledWith({
        ...COMANDO,
        equivalenciaKg: '0.48',
      });
    });

    it('responde 400 sin un comandoId UUID', async () => {
      await como('operario', 'post', 'referencias/desde-celular')
        .send({ ...COMANDO, comandoId: 'provisional' })
        .expect(400);
      expect(referencias.crearDesdeCelular).not.toHaveBeenCalled();
    });

    it('sugiere similares al operario por producto, presentación y kilos', async () => {
      await como(
        'operario',
        'get',
        `productos/${COMANDO.productoId}/presentaciones-similares?presentacion=1000%20g&equivalenciaKg=1`,
      ).expect(200);

      expect(referencias.presentacionesSimilares).toHaveBeenCalledWith(COMANDO.productoId, {
        presentacion: '1000 g',
        equivalenciaKg: '1',
      });
    });
  });
});
