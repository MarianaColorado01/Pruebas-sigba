import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { CategoriasPrismaRepositorio } from '../src/modules/inventario/repositories/categorias.prisma.repositorio.js';
import { ImportacionCatalogoService } from '../src/modules/inventario/services/importacion-catalogo.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Importación de los códigos del Banco contra PostgreSQL (SBA-12, ADR-07).
 *
 * Corre la importación completa (servicio y adaptador de Prisma) con el rol
 * sin privilegios de `rol-de-aplicacion.ts`, sobre la hoja real de códigos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const aqui = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOJA_DEL_BANCO = readFileSync(resolve(aqui, '../prisma/datos/codigos-banco.csv'), 'utf8');

describe.skipIf(!URL_ADMIN)('Importación de códigos del Banco contra PostgreSQL (SBA-12)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let servicio: ImportacionCatalogoService;

  const bancoA = '88888888-8888-8888-8888-888888888888';
  const bancoB = '99999999-9999-9999-9999-999999999999';

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, usuarioId: 'importar-codigos' }, fn) as Promise<R>;
  }

  async function limpiar(): Promise<void> {
    for (const tabla of ['referencia', 'producto', 'categoria']) {
      await admin.$executeRawUnsafe(
        `DELETE FROM inventario.${tabla} WHERE banco_id IN ('${bancoA}', '${bancoB}')`,
      );
    }
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    servicio = new ImportacionCatalogoService(
      new CategoriasPrismaRepositorio(app as PrismaService),
    );
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  async function codigosDe(bancoId: string): Promise<string[]> {
    const filas = await admin.$queryRaw<{ codigo: string }[]>`
      SELECT codigo FROM inventario.categoria WHERE banco_id = ${bancoId}::uuid ORDER BY codigo`;
    return filas.map((f) => f.codigo);
  }

  it('carga los 54 códigos de la hoja del Banco con su línea y el actor', async () => {
    const reporte = await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    expect(reporte).toMatchObject({ creadas: 54, actualizadas: 0, sinCambios: 0, rechazadas: [] });
    const [arroz] = await admin.$queryRaw<
      { nombre: string; linea: string; descripcion: string; creado_por: string }[]
    >`SELECT nombre, linea, descripcion, creado_por FROM inventario.categoria
      WHERE banco_id = ${bancoA}::uuid AND codigo = 'C801'`;
    expect(arroz).toEqual({
      nombre: 'Cereales',
      linea: 'Cereales, raíces, tubérculos, plátanos y derivados',
      descripcion: 'Arroz blanco - Arroz integral - Arroz sopero',
      creado_por: 'importar-codigos',
    });
  });

  it('correrla dos veces no duplica: la segunda deja las 54 sin cambios', async () => {
    await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    const segunda = await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    expect(segunda).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 54 });
    expect(await codigosDe(bancoA)).toHaveLength(54);
  });

  it('actualiza nombre, línea y descripción de un código que ya existe', async () => {
    await enBanco(bancoA, () => servicio.importar('codigo;subcategoria\nB301;Agua'));

    const reporte = await enBanco(bancoA, () =>
      servicio.importar('codigo;subcategoria;linea;productos\nB301;Agua potable;Bebidas;Agua'),
    );

    expect(reporte).toMatchObject({ creadas: 0, actualizadas: 1, sinCambios: 0 });
    const [agua] = await admin.$queryRaw<{ nombre: string; linea: string }[]>`
      SELECT nombre, linea FROM inventario.categoria
      WHERE banco_id = ${bancoA}::uuid AND codigo = 'B301'`;
    expect(agua).toEqual({ nombre: 'Agua potable', linea: 'Bebidas' });
  });

  it('un archivo sin las columnas de línea y productos no borra lo que ya había', async () => {
    await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    const reporte = await enBanco(bancoA, () =>
      servicio.importar('codigo;subcategoria\nC801;Cereales'),
    );

    expect(reporte).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 1 });
    const [arroz] = await admin.$queryRaw<{ linea: string; descripcion: string }[]>`
      SELECT linea, descripcion FROM inventario.categoria
      WHERE banco_id = ${bancoA}::uuid AND codigo = 'C801'`;
    expect(arroz).toEqual({
      linea: 'Cereales, raíces, tubérculos, plátanos y derivados',
      descripcion: 'Arroz blanco - Arroz integral - Arroz sopero',
    });
  });

  it('reporta los productos cuya categoría todavía no tiene código', async () => {
    // El administrador de la prueba es superusuario: siembra sin contexto.
    const [sinCodigo] = await admin.$queryRaw<{ id: string }[]>`
      INSERT INTO inventario.categoria (banco_id, nombre) VALUES (${bancoA}::uuid, 'Sin clasificar')
      RETURNING id::text`;
    await admin.$executeRaw`
      INSERT INTO inventario.producto (banco_id, categoria_id, nombre)
      VALUES (${bancoA}::uuid, ${sinCodigo?.id}::uuid, 'Detergente')`;

    const reporte = await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    expect(reporte.productosSinCodigo).toEqual(['Detergente']);
  });

  it('cada banco importa sus códigos sin ver ni tocar los del otro', async () => {
    await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    const enB = await enBanco(bancoB, () => servicio.importar('codigo;subcategoria\nC801;Arroz'));

    // Para el banco B, C801 es nuevo: no ve el del banco A.
    expect(enB).toMatchObject({ creadas: 1, actualizadas: 0 });
    expect(await codigosDe(bancoB)).toEqual(['C801']);
    const [delA] = await admin.$queryRaw<{ nombre: string }[]>`
      SELECT nombre FROM inventario.categoria WHERE banco_id = ${bancoA}::uuid AND codigo = 'C801'`;
    expect(delA?.nombre).toBe('Cereales');
  });

  it('con un usuario que se salta RLS tampoco toca los códigos de otro banco', async () => {
    // El comando usa DATABASE_URL, y en local ese usuario es superusuario, como
    // el administrador de esta prueba: ahí no hay RLS que filtre.
    const sinRls = new ImportacionCatalogoService(
      new CategoriasPrismaRepositorio(admin as PrismaService),
    );
    await enBanco(bancoA, () => servicio.importar(HOJA_DEL_BANCO));

    const enB = await enBanco(bancoB, () => sinRls.importar('codigo;subcategoria\nC801;Arroz'));

    expect(enB).toMatchObject({ creadas: 1, actualizadas: 0, sinCambios: 0 });
    expect(await codigosDe(bancoB)).toEqual(['C801']);
    const [delA] = await admin.$queryRaw<{ nombre: string }[]>`
      SELECT nombre FROM inventario.categoria WHERE banco_id = ${bancoA}::uuid AND codigo = 'C801'`;
    expect(delA?.nombre).toBe('Cereales');
  });

  it('sin banco en el contexto no escribe', async () => {
    await expect(servicio.importar(HOJA_DEL_BANCO)).rejects.toThrow(/sin banco en el contexto/);
  });
});
