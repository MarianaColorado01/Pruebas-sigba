import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { DespachadorDeEventos } from './core/index.js';
import { configurarApp } from './configurar-app.js';

const archivoEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

// Sin la URL de sigba_app, PrismaService no conecta y la sonda de Fly.io
// respondería OK con la API sin base de datos.
if (!process.env['API_DATABASE_URL']) {
  throw new Error('Configura API_DATABASE_URL con las credenciales del rol sigba_app.');
}

async function bootstrap() {
  // En producción, una línea JSON por evento para el log de Fly.io (RNF-M3-08).
  const json = process.env['NODE_ENV'] === 'production';
  const app = await NestFactory.create(AppModule, { logger: new ConsoleLogger({ json }) });
  configurarApp(app);
  await app.listen(process.env['PORT'] ?? 3000, '0.0.0.0');
  app.get(DespachadorDeEventos).iniciar();
}

await bootstrap();
