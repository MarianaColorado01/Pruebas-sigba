import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configurarApp } from './configurar-app.js';

const archivoEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(archivoEnv)) process.loadEnvFile(archivoEnv);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configurarApp(app);
  await app.listen(process.env['PORT'] ?? 3000, '0.0.0.0');
}

await bootstrap();
