import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant } from '../src/core/database/index.js';

/**
 * Aislamiento entre bancos, contra PostgreSQL de verdad (RNF-01, ADR-07).
 *
 * RNF-01 pide «prueba de aislamiento en el pipeline con cero filas de otro
 * banco». Eso solo lo demuestra el motor: una prueba que simule las políticas
 * en JavaScript comprueba el JavaScript, y seguiría en verde con una política
 * `USING (true)`. ADR-05 lo dice sin rodeos: «la aceptación no sustituye esa
 * prueba».
 *
 * Cada caso de aquí falla si RLS se apaga, si una política se relaja o si el
 * contexto deja de viajar en la transacción.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

/** En CI no hay excusa: la prueba tiene que correr (RNF-01). */
if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const hayBaseDeDatos = Boolean(URL_ADMIN);

/**
 * Rol de aplicación sin privilegios de elusión. Arquitectura 8.1 exige que el
 * rol de ejecución no sea dueño de tablas, ni superusuario, ni BYPASSRLS.
 * Conectarse como superusuario haría pasar la prueba sin demostrar nada.
 */
type FilaBodega = { banco_id: string; nombre: string };

const ROL_APP = 'sigba_app_prueba';
const CLAVE_APP = 'prueba_aislamiento';

function urlComoRolApp(base: string): string {
  const url = new URL(base);
  url.username = ROL_APP;
  url.password = CLAVE_APP;
  return url.toString();
}

describe.skipIf(!hayBaseDeDatos)(
  'Aislamiento entre bancos contra PostgreSQL (RNF-01, ADR-07)',
  () => {
    let admin: PrismaClient;
    let app: PrismaClient;

    const bancoA = '11111111-1111-1111-1111-111111111111';
    const bancoB = '22222222-2222-2222-2222-222222222222';
    const redId = '33333333-3333-3333-3333-333333333333';

    beforeAll(async () => {
      admin = new PrismaClient({ datasourceUrl: URL_ADMIN });

      // Rol de aplicación: sin superusuario y sin BYPASSRLS.
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
      await admin.$executeRawUnsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA plataforma TO ${ROL_APP}`,
      );

      // Datos de dos bancos, sembrados por el administrador para que existan
      // independientemente de lo que el rol de aplicación pueda o no ver.
      await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
      await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
      await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${redId}::uuid`;

      await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${redId}::uuid, 'Red de prueba')`;
      await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${redId}::uuid, 'Banco A', 'PRU-A'),
             (${bancoB}::uuid, ${redId}::uuid, 'Banco B', 'PRU-B')`;
      await admin.$executeRaw`
      INSERT INTO plataforma.bodega (banco_id, nombre)
      VALUES (${bancoA}::uuid, 'Bodega del banco A'),
             (${bancoB}::uuid, 'Bodega del banco B')`;

      app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    });

    afterAll(async () => {
      if (admin) {
        await admin.$executeRaw`DELETE FROM plataforma.bodega WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
        await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
        await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${redId}::uuid`;
        await admin.$disconnect();
      }
      if (app) await app.$disconnect();
    });

    it('el rol de la aplicación no es superusuario ni tiene BYPASSRLS (8.1)', async () => {
      const filas = await app.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

      expect(filas[0]?.rolsuper).toBe(false);
      expect(filas[0]?.rolbypassrls).toBe(false);
    });

    it('las tablas con banco_id tienen RLS activo y forzado', async () => {
      const filas = await app.$queryRaw<{ relname: string; rls: boolean; forzado: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'plataforma'
        AND c.relname IN ('bodega', 'parametro_banco', 'usuario_rol')`;

      expect(filas).toHaveLength(3);
      for (const fila of filas) {
        expect(fila.rls, `${fila.relname} sin RLS`).toBe(true);
        expect(fila.forzado, `${fila.relname} sin FORCE RLS`).toBe(true);
      }
    });

    it('con el contexto del banco A no devuelve ni una fila del banco B', async () => {
      const bodegas = await executeTransactionWithTenant<FilaBodega[]>(
        app,
        (tx) => tx.$queryRaw<FilaBodega[]>`SELECT banco_id, nombre FROM plataforma.bodega`,
        { bancoId: bancoA },
      );

      expect(bodegas.length).toBeGreaterThan(0);
      expect(bodegas.filter((b) => b.banco_id === bancoB)).toHaveLength(0);
      expect(bodegas.every((b) => b.banco_id === bancoA)).toBe(true);
    });

    it('sin contexto no devuelve nada, en vez de devolverlo todo', async () => {
      const bodegas = await executeTransactionWithTenant<{ id: string }[]>(
        app,
        (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM plataforma.bodega`,
        {},
      );

      expect(bodegas).toHaveLength(0);
    });

    it('rechaza escribir una fila de otro banco aunque el contexto sea válido', async () => {
      await expect(
        executeTransactionWithTenant<number>(
          app,
          (tx) => tx.$executeRaw`
          INSERT INTO plataforma.bodega (banco_id, nombre)
          VALUES (${bancoB}::uuid, 'Bodega colada desde el banco A')`,
          { bancoId: bancoA },
        ),
      ).rejects.toThrow();

      // Y no quedó escrita.
      const cuenta = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM plataforma.bodega WHERE nombre = 'Bodega colada desde el banco A'`;
      expect(Number(cuenta[0]?.n ?? 0)).toBe(0);
    });

    it('el contexto no sobrevive a la transacción', async () => {
      await executeTransactionWithTenant<void>(app, async () => undefined, { bancoId: bancoA });

      const filas = await app.$queryRaw<{ valor: string | null }[]>`
      SELECT current_setting('app.banco_id', true) AS valor`;
      const valor = filas[0]?.valor;

      expect(valor === null || valor === undefined || valor === '').toBe(true);
    });

    it('la función de integridad no encuentra tablas con banco_id sin política', async () => {
      await expect(admin.$executeRaw`SELECT core.verificar_politicas_rls()`).resolves.not.toThrow();
    });
  },
);
