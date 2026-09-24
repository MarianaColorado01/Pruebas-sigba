import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant } from '../src/core/database/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Modelo del catálogo contra PostgreSQL (SBA-11, ADR-07).
 *
 * Las reglas del catálogo viven en el esquema (claves únicas, FK compuestas,
 * CHECK y RLS), así que solo el motor puede demostrarlas. Corre con el rol sin
 * privilegios que prepara `rol-de-aplicacion.ts`.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

describe.skipIf(!URL_ADMIN)('Catálogo del inventario contra PostgreSQL (SBA-11)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  const bancoA = '44444444-4444-4444-4444-444444444444';
  const bancoB = '55555555-5555-5555-5555-555555555555';

  /** Corre `fn` con el rol de la aplicación y el contexto de `bancoId`. */
  function comoBanco<R>(bancoId: string, fn: (tx: Prisma.TransactionClient) => Promise<R>) {
    return executeTransactionWithTenant<R>(app, fn, { bancoId });
  }

  async function limpiar(): Promise<void> {
    // El administrador de la prueba es superusuario: salta RLS para limpiar.
    for (const tabla of ['referencia', 'producto', 'categoria']) {
      await admin.$executeRawUnsafe(
        `DELETE FROM inventario.${tabla} WHERE banco_id IN ('${bancoA}', '${bancoB}')`,
      );
    }
  }

  /**
   * Crea una categoría con `codigo` (C801 por defecto, el arroz en la hoja del
   * Banco) y un producto en ella, y devuelve sus ids.
   */
  async function productoEn(bancoId: string, nombre: string, codigo: string | null = 'C801') {
    return comoBanco(bancoId, async (tx) => {
      const categoria = await tx.categoria.create({
        data: { bancoId, codigo, nombre: 'Cereales' },
      });
      const producto = await tx.producto.create({
        data: { bancoId, categoriaId: categoria.id, nombre },
      });
      return { categoriaId: categoria.id, productoId: producto.id };
    });
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });

    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('las tres tablas del catálogo tienen RLS activo y forzado', async () => {
    const filas = await app.$queryRaw<{ relname: string; rls: boolean; forzado: boolean }[]>`
      SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'inventario'
        AND c.relname IN ('categoria', 'producto', 'referencia')`;

    expect(filas).toHaveLength(3);
    for (const fila of filas) {
      expect(fila.rls, `${fila.relname} sin RLS`).toBe(true);
      expect(fila.forzado, `${fila.relname} sin FORCE RLS`).toBe(true);
    }
  });

  it('arroz 500 g, 1 kg y arroba son tres referencias del mismo producto', async () => {
    const { productoId } = await productoEn(bancoA, 'Arroz');

    const referencias = await comoBanco(bancoA, async (tx) => {
      await tx.referencia.createMany({
        data: [
          { bancoId: bancoA, productoId, presentacion: '500 g', equivalenciaKg: '0.5' },
          { bancoId: bancoA, productoId, presentacion: '1 kg', equivalenciaKg: '1' },
          { bancoId: bancoA, productoId, presentacion: 'arroba', equivalenciaKg: '12.5' },
        ],
      });
      return tx.referencia.findMany({ where: { productoId }, orderBy: { equivalenciaKg: 'asc' } });
    });

    expect(referencias.map((r) => r.presentacion)).toEqual(['500 g', '1 kg', 'arroba']);
    expect(new Set(referencias.map((r) => r.id)).size).toBe(3);
  });

  it('una marca distinta no crea otra referencia: producto y presentación se repiten', async () => {
    const { productoId } = await productoEn(bancoA, 'Arroz');
    const arroz500 = { bancoId: bancoA, productoId, presentacion: '500 g', equivalenciaKg: '0.5' };

    await comoBanco(bancoA, (tx) => tx.referencia.create({ data: arroz500 }));

    await expect(
      comoBanco(bancoA, (tx) => tx.referencia.create({ data: arroz500 })),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('las presentaciones de un producto heredan el código de su categoría', async () => {
    const { productoId } = await productoEn(bancoA, 'Arroz');

    const referencias = await comoBanco(bancoA, async (tx) => {
      await tx.referencia.createMany({
        data: [
          { bancoId: bancoA, productoId, presentacion: '500 g', equivalenciaKg: '0.5' },
          { bancoId: bancoA, productoId, presentacion: '1 kg', equivalenciaKg: '1' },
        ],
      });
      return tx.referencia.findMany({
        where: { productoId },
        select: { producto: { select: { categoria: { select: { codigo: true } } } } },
      });
    });

    expect(referencias.map((r) => r.producto.categoria.codigo)).toEqual(['C801', 'C801']);
  });

  it('una referencia cuyo producto no tiene código se acepta y queda pendiente de código', async () => {
    const conCodigo = await productoEn(bancoA, 'Arroz');
    const sinCodigo = await productoEn(bancoA, 'Detergente', null);

    const pendientes = await comoBanco(bancoA, async (tx) => {
      await tx.referencia.create({
        data: {
          bancoId: bancoA,
          productoId: conCodigo.productoId,
          presentacion: '500 g',
          equivalenciaKg: '0.5',
        },
      });
      await tx.referencia.create({
        data: {
          bancoId: bancoA,
          productoId: sinCodigo.productoId,
          presentacion: '1 L',
          equivalenciaKg: '1',
        },
      });
      return tx.referencia.findMany({
        where: { producto: { categoria: { codigo: null } } },
        select: { presentacion: true },
      });
    });

    expect(pendientes).toEqual([{ presentacion: '1 L' }]);
  });

  it('el código no se repite dentro de un banco, pero sí entre bancos', async () => {
    await productoEn(bancoA, 'Arroz', 'C801');

    await expect(productoEn(bancoB, 'Arroz', 'C801')).resolves.toBeDefined();
    await expect(productoEn(bancoA, 'Arroz integral', 'C801')).rejects.toThrow(/Unique constraint/);
  });

  it('varias categorías pueden estar sin código y compartir nombre', async () => {
    await productoEn(bancoA, 'Café', null);

    await expect(productoEn(bancoA, 'Sal', null)).resolves.toBeDefined();
  });

  it('rechaza una equivalencia en kilos que no sea positiva', async () => {
    const { productoId } = await productoEn(bancoA, 'Azúcar');

    await expect(
      comoBanco(bancoA, (tx) =>
        tx.referencia.create({
          data: { bancoId: bancoA, productoId, presentacion: '500 g', equivalenciaKg: '0' },
        }),
      ),
    ).rejects.toThrow(/referencia_equivalencia_kg_positiva/);
  });

  it('con el contexto del banco B no ve ni una fila del catálogo del banco A', async () => {
    const { productoId } = await productoEn(bancoA, 'Arroz');
    await comoBanco(bancoA, (tx) =>
      tx.referencia.create({
        data: { bancoId: bancoA, productoId, presentacion: '500 g', equivalenciaKg: '0.5' },
      }),
    );

    const vistoDesdeB = await comoBanco(bancoB, async (tx) => ({
      categorias: await tx.categoria.count(),
      productos: await tx.producto.count(),
      referencias: await tx.referencia.count(),
    }));

    expect(vistoDesdeB).toEqual({ categorias: 0, productos: 0, referencias: 0 });
  });

  it('rechaza escribir en el catálogo de otro banco aunque el contexto sea válido', async () => {
    await expect(
      comoBanco(bancoA, (tx) =>
        tx.categoria.create({ data: { bancoId: bancoB, nombre: 'Colada' } }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('no deja colgar un producto de la categoría de otro banco', async () => {
    const { categoriaId } = await productoEn(bancoA, 'Arroz');

    // La FK la comprueba Postgres sin RLS: solo la FK compuesta con banco_id
    // impide este cruce.
    await expect(
      comoBanco(bancoB, (tx) =>
        tx.producto.create({ data: { bancoId: bancoB, categoriaId, nombre: 'Arroz ajeno' } }),
      ),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
