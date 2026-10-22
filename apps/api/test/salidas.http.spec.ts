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
import { SalidasController } from '../src/modules/inventario/controllers/salidas.controller.js';
import { SalidaSinStock } from '../src/modules/inventario/services/salida.js';
import { SalidasService } from '../src/modules/inventario/services/salidas.service.js';

/**
 * `POST /salidas` y `GET /salidas/instituciones` por HTTP (SBA-38), sin base
 * de datos: el servicio es un doble y el token lo «verifica» un verificador
 * falso cuyo `sub` es el propio token. Se prueban roles, códigos y el DTO.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const LOTE = '66666666-6666-4666-8666-666666666666';

function conRol(rol: Rol): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
  };
}

const ROLES_DE_DESPACHO: Rol[] = ['operario_bodega', 'voluntario', 'coordinacion', 'admin_banco'];

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  ...Object.fromEntries(ROLES_DE_DESPACHO.map((rol) => [rol, conRol(rol)])),
  institucion: {
    usuarioId: '88888888-0000-4000-8000-000000000003',
    asignaciones: [{ rol: 'institucion', bancoId: BANCO, institucionId: LOTE }],
  },
};

const verificador: TokenVerifier = {
  async verify(token) {
    if (token === 'invalido') throw new Error('firma inválida');
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

const cuerpo = {
  comandoId: 'comando-1',
  institucionId: 'institucion-1',
  bodegaId: 'bodega-1',
  despachador: 'Operario sintético',
  despachadorTipo: 'voluntario',
  detalles: [{ movimientoId: 'm-1', referenciaId: 'r-1', loteId: LOTE, cantidad: 2.5 }],
};

describe('HTTP de las salidas (SBA-38)', () => {
  let app: INestApplication<Server>;
  const salidas = { registrar: vi.fn(), institucionesActivas: vi.fn() };

  function como(sub: string) {
    const agente = request(app.getHttpServer());
    return {
      post: () =>
        agente
          .post('/api/v1/salidas')
          .set('Authorization', `Bearer ${sub}`)
          .set(CABECERAS.banco, BANCO),
      get: () =>
        agente
          .get('/api/v1/salidas/instituciones')
          .set('Authorization', `Bearer ${sub}`)
          .set(CABECERAS.banco, BANCO),
    };
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [SalidasController],
      providers: [...GUARDS_GLOBALES, { provide: SalidasService, useValue: salidas }],
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
    salidas.registrar
      .mockReset()
      .mockResolvedValue({ salida: { id: 'salida-1' }, repetida: false });
    salidas.institucionesActivas
      .mockReset()
      .mockResolvedValue([{ id: 'institucion-1', nombre: 'Parroquia' }]);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it.each(ROLES_DE_DESPACHO)('%s registra una salida con 201', async (rol) => {
    const respuesta = await como(rol).post().send(cuerpo).expect(201);

    expect(respuesta.body).toEqual({ id: 'salida-1' });
    expect(salidas.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        despachadorTipo: 'voluntario',
        detalles: [expect.objectContaining({ cantidad: '2.5' })],
      }),
    );
  });

  it('el reenvío del mismo comando responde 200 con la misma salida', async () => {
    salidas.registrar.mockResolvedValue({ salida: { id: 'salida-1' }, repetida: true });

    const respuesta = await como('operario_bodega').post().send(cuerpo).expect(200);

    expect(respuesta.body).toEqual({ id: 'salida-1' });
  });

  it('sin stock responde 409 con el código y los lotes que faltan', async () => {
    const faltantes = [{ loteId: LOTE, referenciaId: 'r-1', solicitado: '2.5', disponible: '1' }];
    salidas.registrar.mockRejectedValue(new SalidaSinStock(faltantes));

    const respuesta = await como('operario_bodega').post().send(cuerpo).expect(409);

    expect(respuesta.body).toMatchObject({ codigo: 'sin_stock', faltantes });
  });

  it('lista las instituciones activas a quien despacha', async () => {
    const respuesta = await como('voluntario').get().expect(200);

    expect(respuesta.body).toEqual([{ id: 'institucion-1', nombre: 'Parroquia' }]);
  });

  it('responde 401 sin token y 403 al rol institución', async () => {
    await request(app.getHttpServer()).post('/api/v1/salidas').send(cuerpo).expect(401);
    await como('institucion').post().send(cuerpo).expect(403);
    await como('institucion').get().expect(403);
    expect(salidas.registrar).not.toHaveBeenCalled();
  });

  it('responde 400 si faltan campos, sobran o no hay filas', async () => {
    const { despachador: _sinDespachador, ...incompleto } = cuerpo;
    await como('operario_bodega').post().send(incompleto).expect(400);
    await como('operario_bodega')
      .post()
      .send({ ...cuerpo, bancoId: BANCO })
      .expect(400);
    await como('operario_bodega')
      .post()
      .send({ ...cuerpo, detalles: [] })
      .expect(400);
    expect(salidas.registrar).not.toHaveBeenCalled();
  });
});
