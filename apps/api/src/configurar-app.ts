import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { registrarPeticiones } from './core/index.js';
import { corsOrigins } from './cors.js';

/**
 * Lo que `main.ts` le pone a la aplicación y las pruebas HTTP repiten, para que
 * no prueben otra configuración que la de producción.
 */
export function configurarApp(app: INestApplication, origenes = corsOrigins()): void {
  // La PWA lee el ETag del catálogo desde otro origen (ADR-02): sin exponerlo,
  // el navegador lo oculta y la caché nunca sabe si cambió.
  // X-Request-Id es el identificador que la PWA muestra para buscar un error
  // en el log y en Sentry (RNF-M3-08).
  app.enableCors({ origin: origenes, exposedHeaders: ['ETag', 'X-Request-Id'] });
  app.use(registrarPeticiones());

  // Toda la API cuelga de /api/v1 y la PWA se despliega aparte (ADR-02).
  app.setGlobalPrefix('api/v1');

  // Los DTO se validan en ejecución (ADR-04). Un campo que el DTO no declara
  // responde 400 en vez de llegar al servicio.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // El ETag del catálogo lo pone el controlador con la versión del contenido.
  // El de Express, calculado sobre el cuerpo, contestaría 304 por su cuenta.
  app.getHttpAdapter().getInstance().set('etag', false);
}
