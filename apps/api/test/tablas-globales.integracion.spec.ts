import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant, type TenantContext } from '../src/core/database/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Entidades globales: red, rol, banco y usuario (SBA-61, ADR-07, D14).
 *
 * `usuario` tiene RLS propia: cada quien ve su fila y la de quienes tienen una
 * asignación activa en el banco del contexto. Las demás son catálogos sin RLS.
 * Todas están en `core.tabla_global`, y `core.verificar_politicas_rls` falla
 * con cualquier tabla que no tenga banco_id ni fila en ese registro.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de tablas globales no es opcional.',
  );
}

const red = 'a1a1a1a1-0000-4000-8000-000000000061';
const bancoA = 'a1a1a1a1-0000-4000-8000-00000000000a';
const bancoB = 'a1a1a1a1-0000-4000-8000-00000000000b';

const USUARIOS = {
  adminA: 'a1a1a1a1-0000-4000-8000-000000000101',
  soloB: 'a1a1a1a1-0000-4000-8000-000000000102',
  enAyB: 'a1a1a1a1-0000-4000-8000-000000000103',
  inactivoEnA: 'a1a1a1a1-0000-4000-8000-000000000104',
} as const;
const IDS = Object.values(USUARIOS);

describe.skipIf(!URL_ADMIN)('Tablas globales contra PostgreSQL (SBA-61)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  async function limpiar(): Promise<void> {
    await admin.$executeRaw`DELETE FROM plataforma.usuario_rol WHERE usuario_id = ANY(${IDS}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE id = ANY(${IDS}::uuid[])`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
  }

  function asignar(usuario: string, rol: string, banco: string, activo = true) {
    return admin.$executeRaw`
      INSERT INTO plataforma.usuario_rol (usuario_id, rol_id, banco_id, activo)
      SELECT ${usuario}::uuid, id, ${banco}::uuid, ${activo} FROM plataforma.rol WHERE codigo = ${rol}`;
  }

  async function usuariosVisibles(contexto: TenantContext): Promise<string[]> {
    const filas = await executeTransactionWithTenant<{ id: string }[]>(
      app,
      (tx) => tx.$queryRaw<{ id: string }[]>`
        SELECT id::text FROM plataforma.usuario WHERE id = ANY(${IDS}::uuid[])`,
      contexto,
    );
    return filas.map((f) => f.id).sort();
  }

  /** Corre las sentencias y la verificación en una transacción que siempre revierte. */
  async function verificarCon(...sentencias: string[]): Promise<void> {
    const revertir = new Error('revertir');
    try {
      await admin.$transaction(async (tx) => {
        for (const sentencia of sentencias) await tx.$executeRawUnsafe(sentencia);
        await tx.$executeRaw`SELECT core.verificar_politicas_rls()`;
        throw revertir;
      });
    } catch (error) {
      if (error !== revertir) throw error;
    }
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    await limpiar();

    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red globales')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'GLO-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'GLO-B')`;
    for (const [nombre, id] of Object.entries(USUARIOS)) {
      await admin.$executeRaw`
        INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre)
        VALUES (${id}::uuid, 'https://prueba.sigba/', ${`globales|${id}`},
                ${`globales+${id}@example.invalid`}, ${nombre})`;
    }

    await asignar(USUARIOS.adminA, 'admin_banco', bancoA);
    await asignar(USUARIOS.soloB, 'consulta', bancoB);
    await asignar(USUARIOS.enAyB, 'operario_bodega', bancoA);
    await asignar(USUARIOS.enAyB, 'consulta', bancoB);
    await asignar(USUARIOS.inactivoEnA, 'voluntario', bancoA, false);
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('un admin del banco A no ve a quien solo está en B ni a quien tiene la asignación inactiva', async () => {
    const visibles = await usuariosVisibles({ bancoId: bancoA, usuarioId: USUARIOS.adminA });

    expect(visibles).toEqual([USUARIOS.adminA, USUARIOS.enAyB].sort());
  });

  it('en el banco B se ve a quien está en B, aunque también esté en A', async () => {
    const visibles = await usuariosVisibles({ bancoId: bancoB, usuarioId: USUARIOS.soloB });

    expect(visibles).toEqual([USUARIOS.soloB, USUARIOS.enAyB].sort());
  });

  it('sin banco, cada quien ve solo su propia fila', async () => {
    expect(await usuariosVisibles({ usuarioId: USUARIOS.soloB })).toEqual([USUARIOS.soloB]);
  });

  it('sin contexto no ve a nadie', async () => {
    expect(await usuariosVisibles({})).toEqual([]);
  });

  it('la API no escribe en usuario, red, rol ni banco', async () => {
    const filas = await app.$queryRaw<{ tabla: string; escribe: boolean }[]>`
      SELECT t AS tabla,
             has_table_privilege(current_user, t, 'INSERT')
               OR has_table_privilege(current_user, t, 'UPDATE') AS escribe
      FROM unnest(ARRAY['plataforma.usuario', 'plataforma.red', 'plataforma.rol', 'plataforma.banco']) AS t`;

    expect(filas.filter((f) => f.escribe)).toEqual([]);
  });

  it('la verificación pasa con las tablas actuales', async () => {
    await expect(admin.$executeRaw`SELECT core.verificar_politicas_rls()`).resolves.toBeDefined();
  });

  it('una tabla global nueva sin registrar hace fallar la verificación', async () => {
    await expect(
      verificarCon('CREATE TABLE plataforma.prueba_global_sin_control (id uuid PRIMARY KEY)'),
    ).rejects.toThrow(/prueba_global_sin_control no tiene banco_id ni está registrada/);
  });

  it('una tabla global registrada como catálogo pasa sin tocar la función', async () => {
    await expect(
      verificarCon(
        'CREATE TABLE plataforma.prueba_catalogo (id uuid PRIMARY KEY)',
        `INSERT INTO core.tabla_global VALUES ('plataforma', 'prueba_catalogo', 'catalogo', 'prueba')`,
      ),
    ).resolves.toBeUndefined();
  });

  it('una fila con control rls sobre una tabla sin RLS hace fallar la verificación', async () => {
    await expect(
      verificarCon(
        'CREATE TABLE plataforma.prueba_global_rls (id uuid PRIMARY KEY)',
        `INSERT INTO core.tabla_global VALUES ('plataforma', 'prueba_global_rls', 'rls', 'prueba')`,
      ),
    ).rejects.toThrow(/prueba_global_rls necesita ROW LEVEL SECURITY/);
  });

  it('pasar banco a rls sin ponerle RLS hace fallar la verificación', async () => {
    await expect(
      verificarCon(
        `UPDATE core.tabla_global SET control = 'rls' WHERE esquema = 'plataforma' AND tabla = 'banco'`,
      ),
    ).rejects.toThrow(/banco necesita ROW LEVEL SECURITY/);
  });

  it('una fila registrada sin tabla hace fallar la verificación', async () => {
    await expect(
      verificarCon(
        `INSERT INTO core.tabla_global VALUES ('plataforma', 'no_existe', 'catalogo', 'prueba')`,
      ),
    ).rejects.toThrow(/no_existe está registrada en core.tabla_global pero no existe/);
  });

  it('usuario sin FORCE RLS hace fallar la verificación', async () => {
    await expect(
      verificarCon('ALTER TABLE plataforma.usuario NO FORCE ROW LEVEL SECURITY'),
    ).rejects.toThrow(/usuario necesita ROW LEVEL SECURITY/);
  });

  it('un catálogo abierto a PUBLIC hace fallar la verificación', async () => {
    await expect(verificarCon('GRANT SELECT ON plataforma.rol TO PUBLIC')).rejects.toThrow(
      /rol da privilegios a PUBLIC/,
    );
  });
});
