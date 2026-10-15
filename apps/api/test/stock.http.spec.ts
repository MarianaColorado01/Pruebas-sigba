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
import { StockController } from '../src/modules/inventario/controllers/stock.controller.js';
import { StockService } from '../src/modules/inventario/services/stock.service.js';

/**
 * `GET /stock` por HTTP (SBA-36), sin base de datos: el servicio es un doble y
 * el token lo «verifica» un verificador falso cuyo `sub` es el propio token.
 * Se prueban roles, filtros y la validación del DTO.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const BODEGA = '66666666-6666-4666-8666-666666666666';
const CATEGORIA = '77777777-7777-4777-8777-777777777777';
const REFERENCIA = '99999999-9999-4999-8999-999999999999';

function conRol(rol: Rol): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
  };
}

const ROLES_DE_LECTURA: Rol[] = ['operario_bodega', 'voluntario', 'coordinacion', 'admin_banco'];

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  ...Object.fromEntries(ROLES_DE_LECTURA.map((rol) => [rol, conRol(rol)])),
  institucion: {
    usuarioId: '88888888-0000-4000-8000-000000000003',
    asignaciones: [{ rol: 'institucion', bancoId: BANCO, institucionId: CATEGORIA }],
  },
  'sin-rol': { usuarioId: '88888888-0000-4000-8000-000000000002', asignaciones: [] },
};

const verificador: TokenVerifier = {
  async verify(token) {
    if (token === 'invalido') throw new Error('firma inválida');
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

describe('HTTP del stock (SBA-36)', () => {
  let app: INestApplication<Server>;
  const stock = { consultar: vi.fn() };

  function como(sub: string, ruta: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/${ruta}`)
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [StockController],
      providers: [...GUARDS_GLOBALES, { provide: StockService, useValue: stock }],
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
    stock.consultar.mockReset().mockResolvedValue([{ loteId: 'lote-1', estado: 'vigente' }]);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it.each(ROLES_DE_LECTURA)('%s consulta el stock', async (rol) => {
    const respuesta = await como(rol, 'stock').expect(200);

    expect(respuesta.body).toEqual([{ loteId: 'lote-1', estado: 'vigente' }]);
  });

  it('le pasa los filtros al servicio', async () => {
    await como(
      'coordinacion',
      `stock?bodegaId=${BODEGA}&categoriaId=${CATEGORIA}&referenciaId=${REFERENCIA}`,
    ).expect(200);

    expect(stock.consultar).toHaveBeenCalledWith(
      expect.objectContaining({
        bodegaId: BODEGA,
        categoriaId: CATEGORIA,
        referenciaId: REFERENCIA,
      }),
    );
  });

  it('responde 401 sin token o con un token inválido', async () => {
    await request(app.getHttpServer()).get('/api/v1/stock').expect(401);
    await como('invalido', 'stock').expect(401);
  });

  it('responde 403 sin rol en el banco o con un rol que no lee inventario', async () => {
    await como('sin-rol', 'stock').expect(403);
    await como('institucion', 'stock').expect(403);
    expect(stock.consultar).not.toHaveBeenCalled();
  });

  it('responde 400 con un filtro que no es UUID o que el DTO no declara', async () => {
    await como('operario_bodega', 'stock?bodegaId=santa-isabel').expect(400);
    await como('operario_bodega', 'stock?categoriaId=1').expect(400);
    await como('operario_bodega', 'stock?referenciaId=x').expect(400);
    await como('operario_bodega', 'stock?bancoId=otro').expect(400);
    expect(stock.consultar).not.toHaveBeenCalled();
  });
});
