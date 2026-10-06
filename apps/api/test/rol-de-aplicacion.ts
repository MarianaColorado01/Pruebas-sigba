import { PrismaClient } from '@prisma/client';

/**
 * Rol de aplicación para las pruebas de integración (Arquitectura 8.1): sin
 * superusuario ni BYPASSRLS. Conectarse como superusuario haría pasar las
 * pruebas de aislamiento sin demostrar nada.
 *
 * Se prepara una sola vez, en el `globalSetup` de vitest. Si cada archivo
 * hiciera sus GRANT, los archivos que corren en paralelo actualizarían el
 * mismo ACL a la vez y Postgres respondería «tuple concurrently updated».
 */

const ROL_APP = 'sigba_app_prueba';
const CLAVE_APP = 'prueba_aislamiento';

/** La misma base que `DATABASE_URL`, pero con el rol de la aplicación. */
export function urlComoRolApp(base: string): string {
  const url = new URL(base);
  url.username = ROL_APP;
  url.password = CLAVE_APP;
  return url.toString();
}

export default async function prepararRolDeAplicacion(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) return;

  const admin = new PrismaClient({ datasourceUrl: url });
  try {
    await admin.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROL_APP}') THEN
          CREATE ROLE ${ROL_APP} LOGIN PASSWORD '${CLAVE_APP}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
    `);
    // Una sentencia por llamada: Postgres no acepta varias en un statement
    // preparado, que es lo que usa Prisma por debajo.
    await admin.$executeRawUnsafe(
      `GRANT USAGE ON SCHEMA core, plataforma, inventario, beneficiarios, analitica TO ${ROL_APP}`,
    );
    for (const schema of ['plataforma', 'inventario']) {
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${ROL_APP}`,
      );
    }
    await admin.$executeRawUnsafe(
      `REVOKE INSERT, UPDATE, DELETE ON core.auditoria FROM ${ROL_APP}`,
    );
    await admin.$executeRawUnsafe(`GRANT SELECT ON core.auditoria TO ${ROL_APP}`);
    await admin.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION core.registrar_auditoria(text, text, text, text, jsonb) TO ${ROL_APP}`,
    );
  } finally {
    await admin.$disconnect();
  }
}
