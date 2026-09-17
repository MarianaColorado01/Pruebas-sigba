import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Toda la API cuelga de /api/v1 y la PWA se despliega aparte (ADR-02).
  app.setGlobalPrefix('api/v1');

  await app.listen(process.env['PORT'] ?? 3000, '0.0.0.0');
}

await bootstrap();
