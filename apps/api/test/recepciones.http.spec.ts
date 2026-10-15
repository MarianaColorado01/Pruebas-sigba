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
import { RecepcionesController } from '../src/modules/inventario/controllers/recepciones.controller.js';
import { RecepcionesService } from '../src/modules/inventario/services/recepciones.service.js';

/**
 * `POST /api/v1/recepciones` (SBA-24), sin base de datos: el servicio es un
 * doble y el token lo «verifica» un verificador falso cuyo `sub` es el propio
 * token. Prueba lo que pone el controlador: 201 o 200 según el reenvío, roles
 * y la forma del cuerpo. Las reglas y la escritura las cubren
 * `recepciones.service.spec.ts` y `recepciones.integracion.spec.ts`.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';

function conRol(rol: Rol): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId: null }],
  };
}

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  operario: conRol('operario_bodega'),
  voluntario: conRol('voluntario'),
};

const verificador: TokenVerifier = {
  async verify(token) {
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

const COMANDO = {
  comandoId: '01920000-0000-7000-8000-000000000001',
  donanteId: '01920000-0000-7000-8000-000000000002',
  origen: 'propia',
  bodegaId: '01920000-0000-7000-8000-000000000003',
  detalles: [
    {
      movimientoId: '01920000-0000-7000-8000-000000000004',
      referenciaId: '01920000-0000-7000-8000-000000000005',
      cantidad: 4,
      lote: 'L-1',
      vencimiento: null,
    },
  ],
};

describe('HTTP de la recepción (SBA-24)', () => {
  let app: INestApplication<Server>;
  const recepciones = { registrar: vi.fn() };

  function como(sub: string) {
    return request(app.getHttpServer())
      .post('/api/v1/recepciones')
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [RecepcionesController],
      providers: [...GUARDS_GLOBALES, { provide: RecepcionesService, useValue: recepciones }],
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

  beforeEach(() => recepciones.registrar.mockReset());

  afterAll(async () => {
    if (app) await app.close();
  });

  it('responde 201 la primera vez y 200 con la misma recepción si el celular reenvía', async () => {
    const recepcion = { id: 'recepcion-1', detalles: [] };
    recepciones.registrar
      .mockResolvedValueOnce({ recepcion, repetida: false })
      .mockResolvedValueOnce({ recepcion, repetida: true });

    const primera = await como('operario').send(COMANDO).expect(201);
    const segunda = await como('operario').send(COMANDO).expect(200);

    expect(primera.body).toEqual(recepcion);
    expect(segunda.body).toEqual(recepcion);
    expect(recepciones.registrar).toHaveBeenCalledWith({
      ...COMANDO,
      detalles: [{ ...COMANDO.detalles[0], cantidad: '4' }],
    });
  });

  it('responde 400 sin filas, con un campo que el DTO no declara o con una fila mal formada', async () => {
    await como('operario')
      .send({ ...COMANDO, detalles: [] })
      .expect(400);
    await como('operario')
      .send({ ...COMANDO, precio: 1000 })
      .expect(400);
    await como('operario')
      .send({ ...COMANDO, detalles: [{ ...COMANDO.detalles[0], referenciaId: 7 }] })
      .expect(400);
    expect(recepciones.registrar).not.toHaveBeenCalled();
  });

  it('responde 401 sin token y 403 a un rol que no registra recepciones', async () => {
    await request(app.getHttpServer()).post('/api/v1/recepciones').send(COMANDO).expect(401);
    await como('voluntario').send(COMANDO).expect(403);
    expect(recepciones.registrar).not.toHaveBeenCalled();
  });
});
