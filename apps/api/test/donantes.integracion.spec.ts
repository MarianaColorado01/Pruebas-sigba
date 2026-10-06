import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/core/index.js';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
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
    const donante = await enBanco(bancoA, () =>
      repositorio.crear({ nombre: 'Parroquia San José', tipo: 'parroquia', contacto: null }),
    );

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
    const { id } = await enBanco(bancoA, () =>
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
    const { id } = await enBanco(bancoA, () =>
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
    const { id } = await enBanco(bancoA, () =>
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
});
