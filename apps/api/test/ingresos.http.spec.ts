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
import { IngresosController } from '../src/modules/inventario/controllers/ingresos.controller.js';
import { IngresosService } from '../src/modules/inventario/services/ingresos.service.js';

/**
 * Los ingresos del mes por HTTP (SBA-43), sin base de datos: el servicio es un
 * doble y el token lo «verifica» un verificador falso cuyo `sub` es el propio
 * token. Prueba roles y parámetros; las sumas las cubre
 * `valoracion-tardia.integracion.spec.ts`.
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
  voluntario: conRol('voluntario'),
};

const verificador: TokenVerifier = {
  async verify(token) {
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

describe('HTTP de los ingresos del mes (SBA-43)', () => {
  let app: INestApplication<Server>;
  const ingresos = { delMes: vi.fn() };

  function como(sub: string) {
    return request(app.getHttpServer())
      .get('/api/v1/ingresos')
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [IngresosController],
      providers: [...GUARDS_GLOBALES, { provide: IngresosService, useValue: ingresos }],
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

  beforeEach(() => ingresos.delMes.mockReset());

  afterAll(async () => {
    if (app) await app.close();
  });

  it('la coordinación y la administración consultan el mes', async () => {
    const cuerpo = { mes: '2026-10', referencias: [] };
    ingresos.delMes.mockResolvedValue(cuerpo);

    const respuesta = await como('coordinacion').query({ mes: '2026-10' }).expect(200);
    await como('admin').query({ mes: '2026-10' }).expect(200);

    expect(respuesta.body).toEqual(cuerpo);
    expect(ingresos.delMes).toHaveBeenCalledWith('2026-10');
  });

  it('la bodega y el voluntariado no consultan', async () => {
    for (const rol of ['operario', 'voluntario']) {
      await como(rol).query({ mes: '2026-10' }).expect(403);
    }
    expect(ingresos.delMes).not.toHaveBeenCalled();
  });

  it('responde 400 sin mes y 401 sin token', async () => {
    await como('coordinacion').expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/ingresos')
      .query({ mes: '2026-10' })
      .expect(401);
    expect(ingresos.delMes).not.toHaveBeenCalled();
  });
});
