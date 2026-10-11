import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { corsOrigins } from './cors.js';

const archivoEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: corsOrigins() });

  // Toda la API cuelga de /api/v1 y la PWA se despliega aparte (ADR-02).
  app.setGlobalPrefix('api/v1');

  await app.listen(process.env['PORT'] ?? 3000, '0.0.0.0');
}

await bootstrap();
