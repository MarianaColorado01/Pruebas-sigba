import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

/**
 * Las pruebas de integración se conectan como `sigba_app`, el rol de la API,
 * con los privilegios de `prisma/roles/rol-de-api.sql` (Arquitectura 8.1).
 * Conectarse como superusuario haría pasar las pruebas de aislamiento sin
 * demostrar nada, y conceder privilegios aquí probaría otros que los de
 * producción.
 *
 * Se prepara una sola vez, en el `globalSetup` de vitest. Si cada archivo
 * aplicara el script, los archivos que corren en paralelo actualizarían el
 * mismo ACL a la vez y Postgres respondería «tuple concurrently updated».
 */

const ROL_APP = 'sigba_app';
/**
 * Clave de prueba sobre una base efímera con datos sintéticos. Es la de
 * `API_DATABASE_URL` si existe: la e2e levanta `AppModule`, que se conecta
 * con esa URL, y tiene que encontrar la misma clave.
 */
const CLAVE_APP = process.env['API_DATABASE_URL']
  ? decodeURIComponent(new URL(process.env['API_DATABASE_URL']).password)
  : 'prueba_aislamiento';

/** La misma base que `DATABASE_URL`, pero con el rol de la API. */
export function urlComoRolApp(base: string): string {
  const url = new URL(base);
  url.username = ROL_APP;
  url.password = CLAVE_APP;
  return url.toString();
}

/**
 * Aplica `prisma/roles/rol-de-api.sql` con el mismo comando que CI y los
 * despliegues: `db:roles`. Prisma no ejecuta un archivo de varias sentencias
 * desde `$executeRawUnsafe`.
 */
export function aplicarRolDeApi(): void {
  execSync('pnpm run --silent db:roles', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });
}

export default async function prepararRolDeAplicacion(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) return;

  aplicarRolDeApi();

  const admin = new PrismaClient({ datasourceUrl: url });
  try {
    await admin.$executeRawUnsafe(`ALTER ROLE ${ROL_APP} LOGIN PASSWORD '${CLAVE_APP}'`);
  } finally {
    await admin.$disconnect();
  }
}
