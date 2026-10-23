import { readFileSync } from 'node:fs';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/core/index.js';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { DonantesService } from '../src/modules/inventario/services/donantes.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Directorio de donantes contra PostgreSQL (SBA-25, ADR-07).
 *
 * Prueba el adaptador de Prisma con el rol sin privilegios de
 * `rol-de-aplicacion.ts`: la búsqueda, el
 * filtro por tipo y que RLS deje a cada banco con sus donantes. Las reglas del
 * alta las cubre `donantes.service.spec.ts` sin base de datos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

describe.skipIf(!URL_ADMIN)('Directorio de donantes contra PostgreSQL (SBA-25)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let repositorio: DonantesPrismaRepositorio;
  let servicio: DonantesService;

  const bancoA = '66666666-6666-6666-6666-666666666666';
  const bancoB = '77777777-7777-7777-7777-777777777777';

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, usuarioId: 'operario-prueba' }, fn) as Promise<R>;
  }

  async function limpiar(): Promise<void> {
    await admin.$executeRawUnsafe(
      `DELETE FROM inventario.donante WHERE banco_id IN ('${bancoA}', '${bancoB}')`,
    );
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });

    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    repositorio = new DonantesPrismaRepositorio(app as PrismaService, new AuditService());
    servicio = new DonantesService(repositorio);
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('la tabla donante tiene RLS activo y forzado', async () => {
    const filas = await app.$queryRaw<{ rls: boolean; forzado: boolean }[]>`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'inventario' AND c.relname = 'donante'`;

    expect(filas).toEqual([{ rls: true, forzado: true }]);
  });

  it('crea con nombre y tipo y registra banco y actor', async () => {
    const { donante, repetido } = await enBanco(bancoA, () =>
      repositorio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia', contacto: null }),
    );

    expect(repetido).toBe(false);
    expect(donante).toMatchObject({
      nombre: 'Parroquia San José',
      tipo: 'parroquia',
      activo: true,
    });

    const [fila] = await admin.$queryRaw<{ banco_id: string; creado_por: string }[]>`
      SELECT banco_id::text, creado_por FROM inventario.donante WHERE id = ${donante.id}::uuid`;
    expect(fila).toEqual({ banco_id: bancoA, creado_por: 'operario-prueba' });
    const [auditoria] = await admin.$queryRaw<
      {
        banco_id: string;
        actor_etiqueta: string;
        accion: string;
        entidad: string;
        entidad_id: string;
      }[]
    >`SELECT banco_id::text, actor_etiqueta, accion, entidad, entidad_id
      FROM core.auditoria WHERE entidad_id = ${donante.id} ORDER BY ocurrido_en DESC LIMIT 1`;
    expect(auditoria).toEqual({
      banco_id: bancoA,
      actor_etiqueta: 'operario-prueba',
      accion: 'crear',
      entidad: 'donante',
      entidad_id: donante.id,
    });
  });

  it('con parroquia solo devuelve parroquias', async () => {
    await enBanco(bancoA, async () => {
      await repositorio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia', contacto: null });
      await repositorio.crear({ nombre: 'Supermercado La 14', tipo: 'empresa', contacto: null });
    });

    const parroquias = await enBanco(bancoA, () =>
      repositorio.buscar({ tipo: 'parroquia', soloActivos: true, limite: 20 }),
    );

    expect(parroquias.map((d) => d.nombre)).toEqual(['Parroquia San José']);
  });

  it('busca por parte del nombre sin importar mayúsculas, en orden alfabético', async () => {
    await enBanco(bancoA, async () => {
      await repositorio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia', contacto: null });
      await repositorio.crear({
        nombre: 'Fundación Santa Ana',
        tipo: 'otro_banco',
        contacto: null,
      });
      await repositorio.crear({ nombre: 'Supermercado La 14', tipo: 'empresa', contacto: null });
    });

    const encontrados = await enBanco(bancoA, () =>
      repositorio.buscar({ texto: 'SAN', soloActivos: true, limite: 20 }),
    );

    expect(encontrados.map((d) => d.nombre)).toEqual(['Fundación Santa Ana', 'Parroquia San José']);
  });

  it('respeta el límite de la búsqueda', async () => {
    await enBanco(bancoA, async () => {
      for (const nombre of ['A', 'B', 'C']) {
        await repositorio.crear({ nombre, tipo: 'particular', contacto: null });
      }
    });

    const encontrados = await enBanco(bancoA, () =>
      repositorio.buscar({ soloActivos: true, limite: 2 }),
    );

    expect(encontrados.map((d) => d.nombre)).toEqual(['A', 'B']);
  });

  it('un donante desactivado sale de la búsqueda de la recepción pero no de administración', async () => {
    const {
      donante: { id },
    } = await enBanco(bancoA, () =>
      repositorio.crear({ nombre: 'Juan', tipo: 'particular', contacto: null }),
    );
    await enBanco(bancoA, () => repositorio.actualizar(id, { activo: false }));

    const activos = await enBanco(bancoA, () =>
      repositorio.buscar({ soloActivos: true, limite: 20 }),
    );
    const todos = await enBanco(bancoA, () =>
      repositorio.buscar({ soloActivos: false, limite: 20 }),
    );

    expect(activos).toHaveLength(0);
    expect(todos.map((d) => d.activo)).toEqual([false]);
  });

  it('edita solo lo que llega', async () => {
    const {
      donante: { id },
    } = await enBanco(bancoA, () =>
      repositorio.crear({ nombre: 'Juan', tipo: 'particular', contacto: null }),
    );

    const editado = await enBanco(bancoA, () =>
      repositorio.actualizar(id, { contacto: 'juan@ejemplo.test' }),
    );

    expect(editado).toMatchObject({
      nombre: 'Juan',
      tipo: 'particular',
      contacto: 'juan@ejemplo.test',
    });
    const [auditoria] = await admin.$queryRaw<{ accion: string; entidad_id: string }[]>`
      SELECT accion, entidad_id FROM core.auditoria
      WHERE entidad_id = ${id} AND accion = 'actualizar'`;
    expect(auditoria).toEqual({ accion: 'actualizar', entidad_id: id });
  });

  it('el banco B no ve ni puede editar los donantes del banco A', async () => {
    const {
      donante: { id },
    } = await enBanco(bancoA, () =>
      repositorio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia', contacto: null }),
    );

    const vistos = await enBanco(bancoB, () =>
      repositorio.buscar({ soloActivos: false, limite: 20 }),
    );
    const editado = await enBanco(bancoB, () => repositorio.actualizar(id, { nombre: 'Robado' }));

    expect(vistos).toHaveLength(0);
    expect(editado).toBeNull();

    const [fila] = await admin.$queryRaw<{ nombre: string }[]>`
      SELECT nombre FROM inventario.donante WHERE id = ${id}::uuid`;
    expect(fila?.nombre).toBe('Parroquia San José');
  });

  it('sin banco en el contexto no escribe', async () => {
    await expect(
      repositorio.crear({ nombre: 'Sin banco', tipo: 'empresa', contacto: null }),
    ).rejects.toThrow(/sin banco en el contexto/);
  });

  describe('un donante activo por banco, tipo y nombre (SBA-98)', () => {
    async function activosConNombre(nombre: string): Promise<number> {
      const [fila] = await admin.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM inventario.donante
        WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid) AND activo AND lower(nombre) = lower(${nombre})`;
      return fila?.n ?? 0;
    }

    it('con altas iguales y simultáneas queda un solo donante y todas reciben ese', async () => {
      const altas = await enBanco(bancoA, () =>
        Promise.all(
          Array.from({ length: 8 }, () =>
            servicio.darDeAlta({ nombre: 'Parroquia San José', tipo: 'parroquia' }),
          ),
        ),
      );

      expect(new Set(altas.map((a) => a.donante.id)).size).toBe(1);
      expect(altas.filter((a) => !a.repetido)).toHaveLength(1);
      expect(await activosConNombre('Parroquia San José')).toBe(1);
      const [auditoria] = await admin.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core.auditoria
        WHERE entidad = 'donante' AND accion = 'crear' AND entidad_id = ${altas[0]?.donante.id}`;
      expect(auditoria?.n).toBe(1);
    });

    it('el repetido simultáneo ignora mayúsculas y espacios sobrantes', async () => {
      const [a, b] = await enBanco(bancoA, () =>
        Promise.all([
          servicio.darDeAlta({ nombre: 'Supermercado La 14', tipo: 'empresa' }),
          servicio.darDeAlta({ nombre: ' SUPERMERCADO   la 14 ', tipo: 'empresa' }),
        ]),
      );

      expect(b.donante.id).toBe(a.donante.id);
      expect(await activosConNombre('Supermercado La 14')).toBe(1);
    });

    it('encuentra el repetido aunque haya veinte nombres parecidos que ordenan antes', async () => {
      await enBanco(bancoA, async () => {
        for (let n = 10; n < 30; n++) {
          await servicio.darDeAlta({ nombre: `Almacén Éxito ${n}`, tipo: 'empresa' });
        }
      });

      const primero = await enBanco(bancoA, () =>
        servicio.darDeAlta({ nombre: 'Éxito', tipo: 'empresa' }),
      );
      const segundo = await enBanco(bancoA, () =>
        servicio.darDeAlta({ nombre: 'éxito', tipo: 'empresa' }),
      );

      expect(primero.repetido).toBe(false);
      expect(segundo).toEqual({ donante: primero.donante, repetido: true });
      expect(await activosConNombre('Éxito')).toBe(1);
    });

    it('no toma _ ni % del nombre como comodines', async () => {
      const [sin, con] = await enBanco(bancoA, async () => [
        await servicio.darDeAlta({ nombre: '100X Vida', tipo: 'empresa' }),
        await servicio.darDeAlta({ nombre: '100% Vida', tipo: 'empresa' }),
      ]);

      expect(con.repetido).toBe(false);
      expect(sin.repetido).toBe(false);
    });

    it('las tildes cuentan: «Éxito» y «Exito» son dos donantes', async () => {
      const [con, sin] = await enBanco(bancoA, async () => [
        await servicio.darDeAlta({ nombre: 'Éxito', tipo: 'empresa' }),
        await servicio.darDeAlta({ nombre: 'Exito', tipo: 'empresa' }),
      ]);

      expect(con.repetido).toBe(false);
      expect(sin.repetido).toBe(false);
    });

    it('el mismo nombre con otro tipo, o en otro banco, sí se permite', async () => {
      const mismo = { nombre: 'Parroquia San José', tipo: 'parroquia' } as const;
      const enA = await enBanco(bancoA, () => servicio.darDeAlta(mismo));
      const otroTipo = await enBanco(bancoA, () =>
        servicio.darDeAlta({ ...mismo, tipo: 'otro_banco' }),
      );
      const enB = await enBanco(bancoB, () => servicio.darDeAlta(mismo));

      expect([enA.repetido, otroTipo.repetido, enB.repetido]).toEqual([false, false, false]);
      expect(new Set([enA.donante.id, otroTipo.donante.id, enB.donante.id]).size).toBe(3);
      expect(await activosConNombre('Parroquia San José')).toBe(3);
    });

    it('un donante desactivado libera su nombre', async () => {
      const viejo = await enBanco(bancoA, () =>
        servicio.darDeAlta({ nombre: 'Juan', tipo: 'particular' }),
      );
      await enBanco(bancoA, () => servicio.desactivar(viejo.donante.id));

      const nuevo = await enBanco(bancoA, () =>
        servicio.darDeAlta({ nombre: 'Juan', tipo: 'particular' }),
      );

      expect(nuevo.repetido).toBe(false);
      expect(nuevo.donante.id).not.toBe(viejo.donante.id);
    });

    it('renombrar a otro donante activo del mismo tipo responde 409 y no cambia nada', async () => {
      await enBanco(bancoA, () =>
        servicio.darDeAlta({ nombre: 'Parroquia San José', tipo: 'parroquia' }),
      );
      const { donante } = await enBanco(bancoA, () =>
        servicio.darDeAlta({ nombre: 'Parroquia Santa Ana', tipo: 'parroquia' }),
      );

      await expect(
        enBanco(bancoA, () => servicio.editar(donante.id, { nombre: 'PARROQUIA SAN JOSÉ' })),
      ).rejects.toBeInstanceOf(ConflictException);

      const [fila] = await admin.$queryRaw<{ nombre: string }[]>`
        SELECT nombre FROM inventario.donante WHERE id = ${donante.id}::uuid`;
      expect(fila?.nombre).toBe('Parroquia Santa Ana');
    });

    it('la migración desactiva los activos repetidos, deja el más antiguo y crea el índice', async () => {
      const migracion = readFileSync(
        new URL(
          '../prisma/migrations/20261022170000_inventario_donante_unico_activo/migration.sql',
          import.meta.url,
        ),
        'utf8',
      );
      // El estado de antes de la migración: sin índice y con duplicados.
      await admin.$executeRawUnsafe(
        'DROP INDEX inventario.donante_banco_id_tipo_nombre_activo_key',
      );
      try {
        await admin.$executeRawUnsafe(`
          INSERT INTO inventario.donante (id, banco_id, nombre, tipo, activo, creado_en) VALUES
            ('aaaaaaaa-0000-4000-8000-000000000001', '${bancoA}', 'Juan', 'particular', true, '2026-01-01'),
            ('aaaaaaaa-0000-4000-8000-000000000002', '${bancoA}', 'JUAN', 'particular', true, '2026-02-01'),
            ('aaaaaaaa-0000-4000-8000-000000000003', '${bancoA}', 'juan', 'particular', true, '2026-03-01'),
            ('aaaaaaaa-0000-4000-8000-000000000004', '${bancoA}', 'Juan', 'empresa', true, '2026-02-01'),
            ('aaaaaaaa-0000-4000-8000-000000000005', '${bancoB}', 'Juan', 'particular', true, '2026-02-01'),
            ('aaaaaaaa-0000-4000-8000-000000000006', '${bancoA}', 'Juan', 'particular', false, '2026-01-15')`);

        // Prisma no ejecuta varias sentencias en una: se corre una por una.
        for (const sentencia of migracion.replace(/^--.*$/gm, '').split(';')) {
          if (sentencia.trim()) await admin.$executeRawUnsafe(sentencia);
        }

        const filas = await admin.$queryRaw<{ id: string; activo: boolean }[]>`
          SELECT right(id::text, 1) AS id, activo FROM inventario.donante
          WHERE id::text LIKE 'aaaaaaaa-%' ORDER BY id`;
        expect(filas).toEqual([
          { id: '1', activo: true },
          { id: '2', activo: false },
          { id: '3', activo: false },
          { id: '4', activo: true },
          { id: '5', activo: true },
          { id: '6', activo: false },
        ]);
        const [rls] = await admin.$queryRaw<{ forzado: boolean }[]>`
          SELECT relforcerowsecurity AS forzado FROM pg_class
          WHERE oid = 'inventario.donante'::regclass`;
        expect(rls?.forzado).toBe(true);
        await expect(
          admin.$executeRawUnsafe(
            `INSERT INTO inventario.donante (banco_id, nombre, tipo) VALUES ('${bancoA}', 'JUAN', 'particular')`,
          ),
        ).rejects.toThrow(/23505/);
      } finally {
        await limpiar();
        await admin.$executeRawUnsafe(
          'CREATE UNIQUE INDEX IF NOT EXISTS donante_banco_id_tipo_nombre_activo_key ON inventario.donante (banco_id, tipo, lower(nombre)) WHERE activo',
        );
      }
    });
  });
});
