import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';

/**
 * Levanta la aplicación completa. Lo que comprueba antes que nada es que
 * `AppModule` resuelva: un proveedor mal declarado no rompe ninguna prueba
 * unitaria, pero deja la API sin arrancar.
 */
describe('API (e2e)', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    const modulo: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde ok', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(respuesta.body.estado).toBe('ok');
    expect(typeof respuesta.body.tiempoEnPie).toBe('number');
  });

  it('no sirve nada fuera del prefijo /api/v1', () => {
    return request(app.getHttpServer()).get('/health').expect(404);
  });
});
