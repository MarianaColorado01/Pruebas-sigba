import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';

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
    configurarApp(app, ['http://localhost:5173']);
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

  it('el directorio de instituciones exige identidad (SBA-26, SBA-18)', () => {
    return request(app.getHttpServer()).get('/api/v1/instituciones').expect(401);
  });

  it('no sirve nada fuera del prefijo /api/v1', () => {
    return request(app.getHttpServer()).get('/health').expect(404);
  });

  it('permite el preflight de la PWA con Authorization', async () => {
    const respuesta = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
      .expect(204);

    expect(respuesta.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(respuesta.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it('no autoriza el preflight de un origen desconocido', async () => {
    const respuesta = await request(app.getHttpServer())
      .options('/api/v1/health')
      .set('Origin', 'https://origen-desconocido.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
      .expect(204);

    expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
  });
});
