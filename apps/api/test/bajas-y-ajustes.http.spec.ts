import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CABECERAS, type Rol } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsuarioConAsignaciones } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import { AsignacionesDeUsuario } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import {
  CoreModule,
  GUARDS_GLOBALES,
  PrismaService,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../src/core/index.js';
import { configurarApp } from '../src/configurar-app.js';
import { BajasYAjustesController } from '../src/modules/inventario/controllers/bajas-y-ajustes.controller.js';
import { BajasYAjustesService } from '../src/modules/inventario/services/bajas-y-ajustes.service.js';

/**
 * `POST /api/v1/bajas` y `POST /api/v1/ajustes` (SBA-42), sin base de datos:
 * el servicio es un doble y el token lo «verifica» un verificador falso cuyo
 * `sub` es el propio token. Prueba lo que pone el controlador: 201 o 200 según
 * el reenvío, roles y la forma del cuerpo. Las reglas y la escritura las cubren
 * `bajas-y-ajustes.service.spec.ts` y `bajas-y-ajustes.integracion.spec.ts`.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';

function conRol(rol: Rol): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
  };
}

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  coordinacion: conRol('coordinacion'),
  admin: conRol('admin_banco'),
  operario: conRol('operario_bodega'),
};

const verificador: TokenVerifier = {
  async verify(token) {
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

const LOTE = {
  comandoId: '01920000-0000-7000-8000-000000000001',
  movimientoId: '01920000-0000-7000-8000-000000000002',
  bodegaId: '01920000-0000-7000-8000-000000000003',
  referenciaId: '01920000-0000-7000-8000-000000000004',
  loteId: '01920000-0000-7000-8000-000000000005',
};
const BAJA = { ...LOTE, cantidad: 10, motivo: 'vencido' };
const AJUSTE = { ...LOTE, cantidad: -3, motivo: 'Conteo de cierre' };

describe('HTTP de bajas y ajustes (SBA-42)', () => {
  let app: INestApplication<Server>;
  const servicio = { darDeBaja: vi.fn(), ajustar: vi.fn() };

  function como(sub: string, ruta: 'bajas' | 'ajustes') {
    return request(app.getHttpServer())
      .post(`/api/v1/${ruta}`)
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [BajasYAjustesController],
      providers: [...GUARDS_GLOBALES, { provide: BajasYAjustesService, useValue: servicio }],
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
    servicio.darDeBaja.mockReset();
    servicio.ajustar.mockReset();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('una baja responde 201 la primera vez y 200 con el mismo movimiento si se reenvía', async () => {
    const movimiento = { movimientoId: LOTE.movimientoId, tipo: 'baja', cantidad: '-10' };
    servicio.darDeBaja
      .mockResolvedValueOnce({ movimiento, repetida: false })
      .mockResolvedValueOnce({ movimiento, repetida: true });

    const primera = await como('coordinacion', 'bajas').send(BAJA).expect(201);
    const segunda = await como('coordinacion', 'bajas').send(BAJA).expect(200);

    expect(primera.body).toEqual(movimiento);
    expect(segunda.body).toEqual(movimiento);
    expect(servicio.darDeBaja).toHaveBeenCalledWith({ ...BAJA, cantidad: '10' });
  });

  it('un ajuste lo registra la administración del banco con la cantidad como texto', async () => {
    const movimiento = { movimientoId: LOTE.movimientoId, tipo: 'ajuste', cantidad: '-3' };
    servicio.ajustar.mockResolvedValueOnce({ movimiento, repetida: false });

    await como('admin', 'ajustes').send(AJUSTE).expect(201);

    expect(servicio.ajustar).toHaveBeenCalledWith({ ...AJUSTE, cantidad: '-3' });
  });

  it('un ajuste sin motivo responde 400', async () => {
    const { motivo: _motivo, ...sinMotivo } = AJUSTE;

    await como('coordinacion', 'ajustes').send(sinMotivo).expect(400);
    expect(servicio.ajustar).not.toHaveBeenCalled();
  });

  it('responde 400 con un campo que el DTO no declara o con un campo mal formado', async () => {
    await como('coordinacion', 'bajas')
      .send({ ...BAJA, saldo: 0 })
      .expect(400);
    await como('coordinacion', 'bajas')
      .send({ ...BAJA, loteId: 7 })
      .expect(400);
    expect(servicio.darDeBaja).not.toHaveBeenCalled();
  });

  it('el operario de bodega sin rol de coordinación recibe 403 en ajustes y en bajas', async () => {
    await como('operario', 'ajustes').send(AJUSTE).expect(403);
    await como('operario', 'bajas').send(BAJA).expect(403);
    expect(servicio.ajustar).not.toHaveBeenCalled();
    expect(servicio.darDeBaja).not.toHaveBeenCalled();
  });

  it('responde 401 sin token', async () => {
    await request(app.getHttpServer()).post('/api/v1/ajustes').send(AJUSTE).expect(401);
    await request(app.getHttpServer()).post('/api/v1/bajas').send(BAJA).expect(401);
  });
});
