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
import { PreciosController } from '../src/modules/inventario/controllers/precios.controller.js';
import { PreciosService } from '../src/modules/inventario/services/precios.service.js';

/**
 * El maestro de precios por HTTP (SBA-39), sin base de datos: el servicio es
 * un doble y el token lo «verifica» un verificador falso cuyo `sub` es el
 * propio token. Prueba lo que pone el controlador: 201 o 200 según el reenvío,
 * roles por ruta y la forma del cuerpo. Las reglas y la escritura las cubren
 * `precios.service.spec.ts` y `precios.integracion.spec.ts`.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const PRECIO = '01920000-0000-7000-8000-000000000009';
const REFERENCIA = '01920000-0000-7000-8000-000000000005';

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

const PROPUESTA = {
  comandoId: '01920000-0000-7000-8000-000000000001',
  referenciaId: REFERENCIA,
  valor: 2800,
  piso: '2500',
  techo: '3200',
  fuente: 'sipsa',
  evidencia: 'SIPSA-P Pereira, semana 41',
  vigenteDesde: '2026-10-01',
};

describe('HTTP del maestro de precios (SBA-39)', () => {
  let app: INestApplication<Server>;
  const precios = {
    proponer: vi.fn(),
    aprobar: vi.fn(),
    historial: vi.fn(),
    vigente: vi.fn(),
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
      controllers: [PreciosController],
      providers: [...GUARDS_GLOBALES, { provide: PreciosService, useValue: precios }],
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

  beforeEach(() => Object.values(precios).forEach((fn) => fn.mockReset()));

  afterAll(async () => {
    if (app) await app.close();
  });

  it('proponer responde 201 la primera vez y 200 si el cliente reenvía', async () => {
    const precio = { id: PRECIO, estado: 'propuesto' };
    precios.proponer
      .mockResolvedValueOnce({ precio, repetida: false })
      .mockResolvedValueOnce({ precio, repetida: true });

    const primera = await como('coordinacion', 'post', 'precios').send(PROPUESTA).expect(201);
    await como('admin', 'post', 'precios').send(PROPUESTA).expect(200);

    expect(primera.body).toEqual(precio);
    expect(precios.proponer).toHaveBeenCalledWith({ ...PROPUESTA, valor: '2800' });
  });

  it('aprobar responde 201 y 200 al reenvío, con el id de la ruta', async () => {
    const precio = { id: PRECIO, estado: 'aprobado' };
    precios.aprobar
      .mockResolvedValueOnce({ precio, repetida: false })
      .mockResolvedValueOnce({ precio, repetida: true });
    const aprobacion = { comandoId: PROPUESTA.comandoId, motivoFueraDeBanda: 'Alza' };

    await como('coordinacion', 'post', `precios/${PRECIO}/aprobar`).send(aprobacion).expect(201);
    await como('coordinacion', 'post', `precios/${PRECIO}/aprobar`).send(aprobacion).expect(200);

    expect(precios.aprobar).toHaveBeenCalledWith({ ...aprobacion, precioId: PRECIO });
  });

  it('la bodega y el voluntariado consultan pero no proponen ni aprueban', async () => {
    precios.historial.mockResolvedValue([]);
    precios.vigente.mockResolvedValue({ valoracion: 'pendiente', precio: null });

    for (const rol of ['operario', 'voluntario']) {
      await como(rol, 'post', 'precios').send(PROPUESTA).expect(403);
      await como(rol, 'post', `precios/${PRECIO}/aprobar`)
        .send({ comandoId: PROPUESTA.comandoId })
        .expect(403);
      await como(rol, 'get', `referencias/${REFERENCIA}/precios`).expect(200);
      await como(rol, 'get', `referencias/${REFERENCIA}/precio-vigente`).expect(200);
    }
    expect(precios.proponer).not.toHaveBeenCalled();
    expect(precios.aprobar).not.toHaveBeenCalled();
  });

  it('sin precio vigente responde 200 con la valoración pendiente', async () => {
    const pendiente = {
      referenciaId: REFERENCIA,
      fecha: '2026-10-15',
      valoracion: 'pendiente',
      precio: null,
    };
    precios.vigente.mockResolvedValue(pendiente);

    const respuesta = await como('operario', 'get', `referencias/${REFERENCIA}/precio-vigente`)
      .query({ fecha: '2026-10-15' })
      .expect(200);

    expect(respuesta.body).toEqual(pendiente);
    expect(precios.vigente).toHaveBeenCalledWith(REFERENCIA, '2026-10-15');
  });

  it('responde 400 con un campo que el DTO no declara o un id de ruta que no es UUID', async () => {
    await como('coordinacion', 'post', 'precios')
      .send({ ...PROPUESTA, estado: 'aprobado' })
      .expect(400);
    await como('coordinacion', 'post', 'precios/abc/aprobar')
      .send({ comandoId: PROPUESTA.comandoId })
      .expect(400);
    await como('operario', 'get', 'referencias/abc/precios').expect(400);
    expect(precios.proponer).not.toHaveBeenCalled();
    expect(precios.aprobar).not.toHaveBeenCalled();
  });

  it('responde 401 sin token', async () => {
    await request(app.getHttpServer()).post('/api/v1/precios').send(PROPUESTA).expect(401);
    await request(app.getHttpServer())
      .get(`/api/v1/referencias/${REFERENCIA}/precio-vigente`)
      .expect(401);
  });
});
