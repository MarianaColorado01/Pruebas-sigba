import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aplicarRolDeApi, urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * El rol de la API, tal como lo deja `prisma/roles/rol-de-api.sql` (ADR-07,
 * Arquitectura 8.1). Que no lea filas de otro banco lo prueba
 * `aislamiento.integracion.spec.ts`, que se conecta con este mismo rol.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba del rol de la API no es opcional.',
  );
}

const SCHEMAS = ['core', 'plataforma', 'inventario', 'beneficiarios', 'analitica'];

type AtributosRol = {
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolcanlogin: boolean;
  miembroDe: bigint;
};

describe.skipIf(!URL_ADMIN)('Rol de la API sigba_app (ADR-07, 8.1)', () => {
  let admin: PrismaClient;

  const atributos = async () => {
    const [fila] = await admin.$queryRaw<AtributosRol[]>`
      SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin,
             (SELECT count(*) FROM pg_auth_members WHERE member = r.oid) AS "miembroDe"
      FROM pg_roles r WHERE rolname = 'sigba_app'`;
    return fila;
  };

  beforeAll(() => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
  });

  afterAll(async () => {
    if (admin) await admin.$disconnect();
  });

  it('no es superusuario ni tiene BYPASSRLS, CREATEROLE o CREATEDB', async () => {
    expect(await atributos()).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
      rolcreatedb: false,
      miembroDe: 0n,
    });
  });

  // Que cada tabla tenga su GRANT lo exigen las pruebas de integración que la
  // usan, todas como sigba_app. Una tabla que la API solo alcanza por una
  // función SECURITY DEFINER puede quedarse sin ninguno.
  it('ninguna tabla de negocio tiene DELETE', async () => {
    const tablas = await admin.$queryRaw<{ tabla: string; delete: boolean }[]>`
      SELECT format('%I.%I', schemaname, tablename) AS tabla,
             has_table_privilege('sigba_app', format('%I.%I', schemaname, tablename), 'DELETE') AS "delete"
      FROM pg_tables WHERE schemaname = ANY(${SCHEMAS})`;

    expect(tablas.length).toBeGreaterThan(0);
    for (const { tabla, delete: borrar } of tablas) {
      expect(borrar, `${tabla} con DELETE`).toBe(false);
    }
  });

  it('parametro_banco solo permite actualizar fecha_fin', async () => {
    const [privilegios] = await admin.$queryRaw<
      {
        select: boolean;
        insert: boolean;
        update: boolean;
        delete: boolean;
        actualizarFechaFin: boolean;
        actualizarValor: boolean;
      }[]
    >`
      SELECT
        has_table_privilege('sigba_app', 'plataforma.parametro_banco', 'SELECT') AS "select",
        has_table_privilege('sigba_app', 'plataforma.parametro_banco', 'INSERT') AS "insert",
        has_table_privilege('sigba_app', 'plataforma.parametro_banco', 'UPDATE') AS "update",
        has_table_privilege('sigba_app', 'plataforma.parametro_banco', 'DELETE') AS "delete",
        has_column_privilege('sigba_app', 'plataforma.parametro_banco', 'fecha_fin', 'UPDATE') AS "actualizarFechaFin",
        has_column_privilege('sigba_app', 'plataforma.parametro_banco', 'valor', 'UPDATE') AS "actualizarValor"`;

    expect(privilegios).toEqual({
      select: true,
      insert: true,
      update: false,
      delete: false,
      actualizarFechaFin: true,
      actualizarValor: false,
    });
  });

  it('aplicar el script otra vez no falla, no cambia los privilegios ni quita el LOGIN', async () => {
    const privilegios = () => admin.$queryRaw<{ tabla: string; privilegios: string }[]>`
        SELECT format('%I.%I', n.nspname, c.relname) AS tabla,
               string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privilegios
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) a
        WHERE n.nspname = ANY(${SCHEMAS}) AND a.grantee = 'sigba_app'::regrole
        GROUP BY 1
        ORDER BY 1`;
    const antes = await privilegios();

    aplicarRolDeApi();

    expect(await privilegios()).toEqual(antes);
    expect((await atributos())?.rolcanlogin).toBe(true);

    // Y la clave sigue sirviendo.
    const app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    try {
      await expect(app.$queryRaw`SELECT 1`).resolves.toBeDefined();
    } finally {
      await app.$disconnect();
    }
  }, 60_000);
});
