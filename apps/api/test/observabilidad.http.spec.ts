import type { Server } from 'node:http';
import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
  Logger,
  Module,
  Param,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { Test } from '@nestjs/testing';
import { CABECERAS } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configurarApp } from '../src/configurar-app.js';
import { AsignacionesDeUsuario } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import {
  CoreModule,
  GUARDS_GLOBALES,
  PrismaService,
  Roles,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../src/core/index.js';
import { ReportadorDeErrores } from '../src/core/observabilidad/reportador-de-errores.js';

/**
 * Logs y Sentry por HTTP (SBA-83, RNF-M3-08): lo que sale de la API cuando una
 * petición lleva datos personales en la URL y en el mensaje del error.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const USUARIO = '88888888-0000-4000-8000-000000000001';
const DOCUMENTO = '1088234567';
const CORREO = 'persona.sintetica@example.invalid';
const NOMBRE = 'Juana Sintética Pérez';

/** Como un error de Prisma: el mensaje repite los datos de la consulta. */
class ErrorDeConsulta extends Error {
  readonly code = 'P2002';
}

@Controller('fallas')
class FallasController {
  @Get(':documento')
  @Roles('operario_bodega')
  fallar(@Param('documento') documento: string): never {
    throw new Error(`no se pudo guardar a ${CORREO} con documento ${documento}`);
  }

  @Get()
  @Roles('operario_bodega')
  rechazar(): never {
    throw new BadRequestException('cantidad inválida');
  }

  @Get('consulta/rota')
  @Roles('operario_bodega')
  consultar(): never {
    throw new ErrorDeConsulta(`Unique constraint failed: data: { nombre: "${NOMBRE}" }`);
  }

  @Get('proveedor/caido')
  @Roles('operario_bodega')
  proveedor(): never {
    throw new ServiceUnavailableException('El proveedor de precios no responde');
  }

  @Get('flujo/cortado')
  @Roles('operario_bodega')
  flujo(@Res() respuesta: Response): never {
    respuesta.status(200).write('primera parte');
    throw new Error('falló a mitad');
  }
}

// El nombre del módulo es lo que el log reporta como módulo.
@Module({ controllers: [FallasController] })
class InventarioModule {}

const verificador: TokenVerifier = {
  async verify(token) {
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

describe('observabilidad por HTTP (SBA-83)', () => {
  let app: INestApplication<Server>;
  const reportar = vi.fn();
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule, InventarioModule],
      providers: GUARDS_GLOBALES,
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verificador)
      .overrideProvider(AsignacionesDeUsuario)
      .useValue({
        deIdentidad: async () => ({
          usuarioId: USUARIO,
          asignaciones: [{ rol: 'operario_bodega', bancoId: BANCO, institucionId: null }],
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(ReportadorDeErrores)
      .useValue({ reportar })
      .compile();

    app = modulo.createNestApplication({ logger: false });
    configurarApp(app, ['http://localhost:5173']);
    await app.init();
  });

  beforeEach(() => {
    reportar.mockReset();
    log.mockClear();
    error.mockClear();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (app) await app.close();
  });

  function pedir(ruta: string) {
    return request(app.getHttpServer())
      .get(`/api/v1/${ruta}`)
      .set('Authorization', 'Bearer token-sintetico')
      .set(CABECERAS.banco, BANCO);
  }

  /** Todo lo que la API escribió en el log y mandó a Sentry, como texto. */
  function todoLoQueSalio(): string {
    return JSON.stringify([log.mock.calls, error.mock.calls, reportar.mock.calls]);
  }

  it('un 5xx responde solo el peticionId, el mismo de X-Request-Id y de Sentry', async () => {
    const respuesta = await pedir(`fallas/${DOCUMENTO}?correo=${CORREO}`).expect(500);

    const peticionId = respuesta.headers['x-request-id'];
    expect(peticionId).toMatch(/^[\da-f]{32}$/);
    expect(respuesta.body).toEqual({
      statusCode: 500,
      message: 'Error interno del servidor',
      peticionId,
    });
    expect(reportar).toHaveBeenCalledWith(
      expect.objectContaining({
        peticionId,
        metodo: 'GET',
        ruta: '/api/v1/fallas/:documento',
        modulo: 'inventario',
        usuarioId: USUARIO,
        bancoId: BANCO,
        mensaje: '',
      }),
    );
  });

  it('un error inesperado sale sin mensaje: solo su código y la pila', async () => {
    await pedir('fallas/consulta/rota').expect(500);

    expect(reportar).toHaveBeenCalledWith(
      expect.objectContaining({ nombre: 'Error', mensaje: 'código P2002' }),
    );
    expect(todoLoQueSalio()).not.toContain(NOMBRE);
  });

  it('un 5xx lanzado a propósito responde su mensaje y también va a Sentry', async () => {
    const respuesta = await pedir('fallas/proveedor/caido').expect(503);

    expect(respuesta.body.message).toBe('El proveedor de precios no responde');
    expect(reportar).toHaveBeenCalledWith(
      expect.objectContaining({ mensaje: 'El proveedor de precios no responde' }),
    );
  });

  it('si la respuesta ya empezó, la corta y reporta el error', async () => {
    const respuesta = await pedir('fallas/flujo/cortado');

    expect(respuesta.status).toBe(200);
    expect(reportar).toHaveBeenCalledTimes(1);
  });

  it('ni el log ni Sentry reciben el documento, el correo ni el token', async () => {
    await pedir(`fallas/${DOCUMENTO}?correo=${CORREO}`).expect(500);

    const salida = todoLoQueSalio();
    expect(salida).not.toContain(DOCUMENTO);
    expect(salida).not.toContain(CORREO);
    expect(salida).not.toContain('token-sintetico');
  });

  it('escribe una línea por petición con ruta, estado, módulo, usuario y banco', async () => {
    const respuesta = await pedir('fallas').expect(400);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        peticionId: respuesta.headers['x-request-id'],
        metodo: 'GET',
        ruta: '/api/v1/fallas',
        estado: 400,
        modulo: 'inventario',
        usuarioId: USUARIO,
        bancoId: BANCO,
        duracionMs: expect.any(Number),
      }),
    );
    expect(reportar).not.toHaveBeenCalled();
  });

  it('un 4xx sigue con la respuesta de Nest', async () => {
    const respuesta = await pedir('fallas').expect(400);

    expect(respuesta.body.message).toBe('cantidad inválida');
  });

  it('un 401 también queda en el log, sin módulo ni usuario', async () => {
    await request(app.getHttpServer()).get(`/api/v1/fallas/${DOCUMENTO}`).expect(401);

    const [linea] = log.mock.calls.at(-1) as [Record<string, unknown>];
    expect(linea).toMatchObject({ estado: 401, ruta: '/api/v1/fallas/:documento' });
    expect(linea).not.toHaveProperty('usuarioId');
    expect(todoLoQueSalio()).not.toContain(DOCUMENTO);
  });

  it('expone X-Request-Id por CORS para que la PWA lo muestre', async () => {
    const respuesta = await pedir('fallas').set('Origin', 'http://localhost:5173').expect(400);

    expect(respuesta.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });
});
