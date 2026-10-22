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
import { TiposDePoblacionController } from '../src/modules/beneficiarios/controllers/tipos-de-poblacion.controller.js';
import { DirectorioDeInstitucionesService } from '../src/modules/beneficiarios/services/directorio-de-instituciones.service.js';

/**
 * `GET /tipos-de-poblacion` por HTTP (SBA-86), sin base de datos: el servicio
 * es un doble y el token lo «verifica» un verificador falso cuyo `sub` es el
 * rol. Prueba los roles de la ruta; el aislamiento entre bancos lo cubre
 * `instituciones.integracion.spec.ts`.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';

const USUARIOS = Object.fromEntries(
  (['admin_banco', 'coordinacion', 'operario_bodega', 'voluntario', 'consulta'] as Rol[]).map(
    (rol): [string, UsuarioConAsignaciones] => [
      rol,
      {
        usuarioId: '88888888-0000-4000-8000-000000000001',
        asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
      },
    ],
  ),
);

const verificador: TokenVerifier = {
  async verify(token) {
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

describe('HTTP de los tipos de población (SBA-86)', () => {
  let app: INestApplication<Server>;
  const directorio = { tiposDePoblacion: vi.fn() };

  const como = (rol: string) =>
    request(app.getHttpServer())
      .get('/api/v1/tipos-de-poblacion')
      .set('Authorization', `Bearer ${rol}`)
      .set(CABECERAS.banco, BANCO);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [TiposDePoblacionController],
      providers: [
        ...GUARDS_GLOBALES,
        { provide: DirectorioDeInstitucionesService, useValue: directorio },
      ],
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

  beforeEach(() => directorio.tiposDePoblacion.mockReset());

  afterAll(async () => {
    if (app) await app.close();
  });

  it('administración del banco y coordinación reciben el catálogo', async () => {
    const tipos = [{ id: 'p-1', nombre: 'Familias', activo: true }];
    directorio.tiposDePoblacion.mockResolvedValue(tipos);

    for (const rol of ['admin_banco', 'coordinacion']) {
      const respuesta = await como(rol).expect(200);
      expect(respuesta.body).toEqual(tipos);
    }
  });

  it('responde 403 a la bodega, al voluntariado y a consulta', async () => {
    for (const rol of ['operario_bodega', 'voluntario', 'consulta']) {
      await como(rol).expect(403);
    }
    expect(directorio.tiposDePoblacion).not.toHaveBeenCalled();
  });
});
