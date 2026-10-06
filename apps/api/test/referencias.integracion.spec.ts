import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/core/index.js';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Catálogo contra PostgreSQL (SBA-22, ADR-07).
 *
 * Prueba el servicio con el adaptador de Prisma y el rol sin privilegios de
 * `rol-de-aplicacion.ts`: la búsqueda por nombre, presentación y código, el
 * catálogo para la caché de la PWA, las claves únicas y que RLS deje a cada
 * banco con su catálogo.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const aqui = resolve(fileURLToPath(new URL('.', import.meta.url)));
const HOJA_DEL_BANCO = readFileSync(resolve(aqui, '../prisma/datos/codigos-banco.csv'), 'utf8');

describe.skipIf(!URL_ADMIN)('Catálogo contra PostgreSQL (SBA-22)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let servicio: ReferenciasService;
  let repositorio: ReferenciasPrismaRepositorio;

  const bancoA = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, usuarioId: 'coordinacion-prueba' }, fn) as Promise<R>;
  }

  async function limpiar(): Promise<void> {
    // El administrador de la prueba es superusuario: salta RLS para limpiar.
    for (const tabla of ['referencia', 'producto', 'categoria']) {
      await admin.$executeRawUnsafe(
        `DELETE FROM inventario.${tabla} WHERE banco_id IN ('${bancoA}', '${bancoB}')`,
      );
    }
  }

  async function auditoriaDe(entidadId: string) {
    return admin.$queryRaw<
      {
        banco_id: string;
        actor_tipo: string;
        actor_id: string | null;
        actor_etiqueta: string | null;
        accion: string;
        entidad: string;
        entidad_id: string;
      }[]
    >`SELECT banco_id::text, actor_tipo, actor_id::text, actor_etiqueta, accion, entidad, entidad_id
      FROM core.auditoria
      WHERE entidad_id = ${entidadId}`;
  }

  /** Arroz en tres presentaciones bajo C801 y frijol bajo C802, en el banco A. */
  async function catalogoDePrueba() {
    return enBanco(bancoA, async () => {
      const cereales = await servicio.crearCategoria({
        codigo: 'C801',
        nombre: 'Arroz',
        linea: 'Cereales',
      });
      const granos = await servicio.crearCategoria({
        codigo: 'C802',
        nombre: 'Frijol',
        linea: 'Granos',
      });
      const arroz = await servicio.crearProducto({ categoriaId: cereales.id, nombre: 'Arroz' });
      const frijol = await servicio.crearProducto({ categoriaId: granos.id, nombre: 'Frijol' });
      const arroba = await servicio.crearReferencia({
        productoId: arroz.id,
        presentacion: 'arroba',
        equivalenciaKg: '12,5',
      });
      const kilo = await servicio.crearReferencia({
        productoId: arroz.id,
        presentacion: '1 kg',
        equivalenciaKg: 1,
      });
      const medio = await servicio.crearReferencia({
        productoId: arroz.id,
        presentacion: '500 g',
        equivalenciaKg: 0.5,
      });
      const frijolMedio = await servicio.crearReferencia({
        productoId: frijol.id,
        presentacion: '500 g',
        equivalenciaKg: 0.5,
      });
      return { cereales, arroz, frijol, arroba, kilo, medio, frijolMedio };
    });
  }

  /**
   * Llena el banco A con miles de referencias: las 54 categorías de la hoja del
   * Banco, 8 productos en cada una y 10 presentaciones por producto, que suman
   * 432 productos y 4.320 referencias. Las escribe el administrador con
   * createMany para que la suite no tarde. Ningún nombre ni presentación
   * contiene «arr», así que buscarlo recorre todo y encuentra lo mismo que en
   * `catalogoDePrueba`. Devuelve cuántas referencias quedan en el banco.
   */
  async function llenarCatalogo(): Promise<number> {
    const filas = HOJA_DEL_BANCO.trim().split(/\r?\n/).slice(1);
    await admin.categoria.createMany({
      data: filas.map((fila) => {
        const [, linea = '', codigo = '', nombre = ''] = fila.split(';');
        return { bancoId: bancoA, codigo, nombre, linea };
      }),
      // C801 y C802 ya existen: las creó catalogoDePrueba.
      skipDuplicates: true,
    });
    const categorias = await admin.categoria.findMany({
      where: { bancoId: bancoA },
      select: { id: true, codigo: true },
    });

    const productos = categorias.flatMap(({ id, codigo }) =>
      Array.from({ length: 8 }, (_, i) => ({
        id: randomUUID(),
        bancoId: bancoA,
        categoriaId: id,
        nombre: `Producto ${codigo}-${i + 1}`,
      })),
    );
    await admin.producto.createMany({ data: productos });
    await admin.referencia.createMany({
      data: productos.flatMap(({ id }) =>
        Array.from({ length: 10 }, (_, i) => ({
          bancoId: bancoA,
          productoId: id,
          presentacion: `${(i + 1) * 250} g`,
          equivalenciaKg: (i + 1) * 0.25,
        })),
      ),
    });

    return admin.referencia.count({ where: { bancoId: bancoA } });
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    repositorio = new ReferenciasPrismaRepositorio(app as PrismaService, new AuditService());
    servicio = new ReferenciasService(repositorio);
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('entre miles de referencias, «arr» encuentra arroz 500 g, 1 kg y arroba, de menor a mayor, en menos de 300 ms', async () => {
    const creados = await catalogoDePrueba();
    await expect(auditoriaDe(creados.cereales.id)).resolves.toEqual([
      {
        banco_id: bancoA,
        actor_tipo: 'sistema',
        actor_id: null,
        actor_etiqueta: 'coordinacion-prueba',
        accion: 'crear',
        entidad: 'categoria',
        entidad_id: creados.cereales.id,
      },
    ]);
    await expect(auditoriaDe(creados.arroz.id)).resolves.toEqual([
      {
        banco_id: bancoA,
        actor_tipo: 'sistema',
        actor_id: null,
        actor_etiqueta: 'coordinacion-prueba',
        accion: 'crear',
        entidad: 'producto',
        entidad_id: creados.arroz.id,
      },
    ]);
    await expect(auditoriaDe(creados.medio.id)).resolves.toEqual([
      {
        banco_id: bancoA,
        actor_tipo: 'sistema',
        actor_id: null,
        actor_etiqueta: 'coordinacion-prueba',
        accion: 'crear',
        entidad: 'referencia',
        entidad_id: creados.medio.id,
      },
    ]);
    expect(await llenarCatalogo()).toBe(4324); // las 4.320 del volumen y las 4 de catalogoDePrueba
    await enBanco(bancoA, () => servicio.buscar({ texto: 'a' })); // conexión ya abierta

    const inicio = performance.now();
    const encontradas = await enBanco(bancoA, () => servicio.buscar({ texto: 'arr' }));
    const milisegundos = performance.now() - inicio;

    expect(encontradas.map((r) => `${r.producto.nombre} ${r.presentacion}`)).toEqual([
      'Arroz 500 g',
      'Arroz 1 kg',
      'Arroz arroba',
    ]);
    expect(encontradas[0]).toMatchObject({
      equivalenciaKg: '0.5',
      categoria: { codigo: 'C801', linea: 'Cereales' },
    });
    expect(milisegundos).toBeLessThan(300);
  });

  it('audita la actualización de cada fila de categoría, producto y referencia', async () => {
    const creados = await catalogoDePrueba();
    await enBanco(bancoA, async () => {
      await repositorio.actualizarCategoria(creados.cereales.id, {
        linea: 'Cereales actualizados',
      });
      await repositorio.actualizarProducto(creados.arroz.id, { nombre: 'Arroz actualizado' });
      await repositorio.actualizarReferencia(creados.medio.id, {
        presentacion: '500 g actualizado',
      });
    });

    for (const [id, entidad] of [
      [creados.cereales.id, 'categoria'],
      [creados.arroz.id, 'producto'],
      [creados.medio.id, 'referencia'],
    ] as const) {
      const registros = await auditoriaDe(id);
      expect(registros).toEqual([
        {
          banco_id: bancoA,
          actor_tipo: 'sistema',
          actor_id: null,
          actor_etiqueta: 'coordinacion-prueba',
          accion: 'actualizar',
          entidad,
          entidad_id: id,
        },
      ]);
    }
  });

  it('el código del Banco devuelve las referencias de ese código y de ningún otro', async () => {
    await catalogoDePrueba();

    const encontradas = await enBanco(bancoA, () => servicio.buscar({ texto: 'c801' }));

    expect(encontradas).toHaveLength(3);
    expect(encontradas.every((r) => r.categoria.codigo === 'C801')).toBe(true);
  });

  it('cada palabra filtra: «arroz 1» deja solo el kilo', async () => {
    const { kilo } = await catalogoDePrueba();

    const encontradas = await enBanco(bancoA, () => servicio.buscar({ texto: 'arroz 1' }));

    expect(encontradas.map((r) => r.id)).toEqual([kilo.id]);
  });

  it('dos presentaciones con la misma equivalencia salen siempre en el mismo orden', async () => {
    const { arroz } = await catalogoDePrueba();
    await enBanco(bancoA, () =>
      servicio.crearReferencia({
        productoId: arroz.id,
        presentacion: '1 bolsa',
        equivalenciaKg: 1,
      }),
    );

    const encontradas = await enBanco(bancoA, () => servicio.buscar({ texto: 'arroz' }));

    expect(encontradas.map((r) => r.presentacion)).toEqual(['500 g', '1 bolsa', '1 kg', 'arroba']);
  });

  it('filtra por categoría', async () => {
    const { cereales } = await catalogoDePrueba();

    const encontradas = await enBanco(bancoA, () => servicio.buscar({ categoriaId: cereales.id }));

    expect(encontradas).toHaveLength(3);
  });

  it('lo desactivado no aparece salvo que se pida, y una categoría inactiva oculta sus referencias', async () => {
    const { cereales, arroba } = await catalogoDePrueba();

    await enBanco(bancoA, () => servicio.desactivarReferencia(arroba.id));
    const activas = await enBanco(bancoA, () => servicio.buscar({ texto: 'arroz' }));
    const todas = await enBanco(bancoA, () =>
      servicio.buscar({ texto: 'arroz', incluirInactivas: true }),
    );

    expect(activas).toHaveLength(2);
    expect(todas).toHaveLength(3);

    await enBanco(bancoA, () => servicio.desactivarCategoria(cereales.id));
    expect(await enBanco(bancoA, () => servicio.buscar({ texto: 'arroz' }))).toEqual([]);
  });

  it('lo desactivado por error no se crea otra vez: responde 409 y al reactivarlo vuelve a la búsqueda', async () => {
    const { cereales, arroz, arroba } = await catalogoDePrueba();
    const buscarEnA = (texto: string) => enBanco(bancoA, () => servicio.buscar({ texto }));

    await enBanco(bancoA, () => servicio.desactivarReferencia(arroba.id));
    await expect(
      enBanco(bancoA, () =>
        servicio.crearReferencia({
          productoId: arroz.id,
          presentacion: 'arroba',
          equivalenciaKg: '12,5',
        }),
      ),
    ).rejects.toThrow('Ese producto ya tiene esa presentación.');
    await enBanco(bancoA, () => servicio.reactivarReferencia(arroba.id));
    expect((await buscarEnA('arroba')).map((r) => r.id)).toEqual([arroba.id]);

    await enBanco(bancoA, () => servicio.desactivarProducto(arroz.id));
    await expect(
      enBanco(bancoA, () => servicio.crearProducto({ categoriaId: cereales.id, nombre: 'Arroz' })),
    ).rejects.toThrow('Ya existe un producto con ese nombre.');
    await enBanco(bancoA, () => servicio.reactivarProducto(arroz.id));
    expect(await buscarEnA('arroz')).toHaveLength(3);

    await enBanco(bancoA, () => servicio.desactivarCategoria(cereales.id));
    await expect(
      enBanco(bancoA, () => servicio.crearCategoria({ codigo: 'C801', nombre: 'Arroz' })),
    ).rejects.toThrow('Ya existe una categoría con ese código.');
    await enBanco(bancoA, () => servicio.reactivarCategoria(cereales.id));
    expect(await buscarEnA('c801')).toHaveLength(3);
  });

  describe('padre desactivado', () => {
    it('una categoría desactivada no recibe productos ni presentaciones: responde 409 y no escribe', async () => {
      const { cereales, arroz, frijol } = await catalogoDePrueba();
      await enBanco(bancoA, () => servicio.desactivarCategoria(cereales.id));
      const categoriaDesactivada =
        'La categoría está desactivada. Reactívala antes de agregarle productos.';

      await expect(
        enBanco(bancoA, () => servicio.crearProducto({ categoriaId: cereales.id, nombre: 'Maíz' })),
      ).rejects.toThrow(categoriaDesactivada);
      await expect(
        enBanco(bancoA, () => servicio.editarProducto(frijol.id, { categoriaId: cereales.id })),
      ).rejects.toThrow(categoriaDesactivada);
      await expect(
        enBanco(bancoA, () =>
          servicio.crearReferencia({
            productoId: arroz.id,
            presentacion: '2 kg',
            equivalenciaKg: 2,
          }),
        ),
      ).rejects.toThrow(
        'La categoría de ese producto está desactivada. Reactívala antes de agregarle presentaciones.',
      );

      const productos = await admin.producto.findMany({
        where: { bancoId: bancoA },
        select: { nombre: true, categoriaId: true },
        orderBy: { nombre: 'asc' },
      });
      expect(productos).toEqual([
        { nombre: 'Arroz', categoriaId: cereales.id },
        { nombre: 'Frijol', categoriaId: frijol.categoriaId },
      ]);
      expect(await admin.referencia.count({ where: { bancoId: bancoA } })).toBe(4);
    });

    it('un producto desactivado no recibe presentaciones hasta que se reactive', async () => {
      const { arroz, frijol, frijolMedio } = await catalogoDePrueba();
      await enBanco(bancoA, () => servicio.desactivarProducto(arroz.id));
      const productoDesactivado =
        'El producto está desactivado. Reactívalo antes de agregarle presentaciones.';
      const dosKilos = { productoId: arroz.id, presentacion: '2 kg', equivalenciaKg: 2 };

      await expect(enBanco(bancoA, () => servicio.crearReferencia(dosKilos))).rejects.toThrow(
        productoDesactivado,
      );
      await expect(
        enBanco(bancoA, () => servicio.editarReferencia(frijolMedio.id, { productoId: arroz.id })),
      ).rejects.toThrow(productoDesactivado);
      const frijolIntacto = await enBanco(bancoA, () => servicio.buscar({ texto: 'frijol' }));
      expect(frijolIntacto.map((r) => [r.id, r.producto.id])).toEqual([
        [frijolMedio.id, frijol.id],
      ]);

      await enBanco(bancoA, () => servicio.reactivarProducto(arroz.id));
      const creada = await enBanco(bancoA, () => servicio.crearReferencia(dosKilos));
      expect(creada).toMatchObject({ presentacion: '2 kg', producto: { id: arroz.id } });
    });

    it('editar sin cambiar de padre no responde 409, y un id que no existe sigue dando 404', async () => {
      const { cereales, arroz, kilo } = await catalogoDePrueba();
      await enBanco(bancoA, () => servicio.desactivarCategoria(cereales.id));

      // Un formulario que manda todos los campos reenvía el padre que la fila ya tiene.
      const producto = await enBanco(bancoA, () =>
        servicio.editarProducto(arroz.id, { categoriaId: cereales.id, nombre: 'Arroz blanco' }),
      );
      const referencia = await enBanco(bancoA, () =>
        servicio.editarReferencia(kilo.id, { productoId: arroz.id, presentacion: '1 kilo' }),
      );

      expect(producto).toMatchObject({ categoriaId: cereales.id, nombre: 'Arroz blanco' });
      expect(referencia).toMatchObject({ presentacion: '1 kilo', producto: { id: arroz.id } });
      await expect(
        enBanco(bancoA, () => servicio.editarProducto(randomUUID(), { categoriaId: cereales.id })),
      ).rejects.toThrow('No existe ese producto.');
      await expect(
        enBanco(bancoA, () => servicio.editarReferencia(randomUUID(), { productoId: arroz.id })),
      ).rejects.toThrow('No existe esa referencia.');
    });
  });

  it('el catálogo agrupa por categoría y su versión cambia solo si cambia el contenido', async () => {
    const { medio } = await catalogoDePrueba();

    const primero = await enBanco(bancoA, () => servicio.catalogo());
    const igual = await enBanco(bancoA, () => servicio.catalogo());

    expect(primero.categorias.map((c) => c.codigo)).toEqual(['C801', 'C802']);
    expect(primero.categorias[0]?.productos[0]?.referencias.map((r) => r.presentacion)).toEqual([
      '500 g',
      '1 kg',
      'arroba',
    ]);
    expect(igual.version).toBe(primero.version);

    await enBanco(bancoA, () => servicio.editarReferencia(medio.id, { presentacion: '500 gr' }));
    const cambiado = await enBanco(bancoA, () => servicio.catalogo());

    expect(cambiado.version).not.toBe(primero.version);
  });

  it('una presentación repetida o un producto con el mismo nombre responden 409', async () => {
    const { cereales, arroz } = await catalogoDePrueba();

    await expect(
      enBanco(bancoA, () =>
        servicio.crearReferencia({ productoId: arroz.id, presentacion: '1 kg', equivalenciaKg: 1 }),
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      enBanco(bancoA, () => servicio.crearProducto({ categoriaId: cereales.id, nombre: 'Arroz' })),
    ).rejects.toThrow(ConflictException);
    await expect(
      enBanco(bancoA, () => servicio.crearCategoria({ codigo: 'C801', nombre: 'Otro' })),
    ).rejects.toThrow(ConflictException);
  });

  it('asigna código a un producto moviéndolo de categoría', async () => {
    const { arroz } = await catalogoDePrueba();

    const editado = await enBanco(bancoA, async () => {
      const sinCodigo = await servicio.crearCategoria({ nombre: 'Por clasificar' });
      await servicio.editarProducto(arroz.id, { categoriaId: sinCodigo.id });
      return servicio.buscar({ texto: 'arroz' });
    });

    expect(editado.every((r) => r.categoria.codigo === null)).toBe(true);
  });

  it('registra banco y actor en cada alta y edición', async () => {
    const { kilo } = await catalogoDePrueba();
    await enBanco(bancoA, () => servicio.editarReferencia(kilo.id, { equivalenciaKg: '1.000' }));

    const [fila] = await admin.$queryRaw<
      { banco_id: string; creado_por: string; actualizado_por: string }[]
    >`SELECT banco_id::text, creado_por, actualizado_por FROM inventario.referencia WHERE id = ${kilo.id}::uuid`;

    expect(fila).toEqual({
      banco_id: bancoA,
      creado_por: 'coordinacion-prueba',
      actualizado_por: 'coordinacion-prueba',
    });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('el banco B no ve el catálogo del banco A', async () => {
      await catalogoDePrueba();

      expect(await enBanco(bancoB, () => servicio.buscar({ texto: 'arroz' }))).toEqual([]);
      expect(await enBanco(bancoB, () => servicio.buscar({ texto: 'c801' }))).toEqual([]);
      expect((await enBanco(bancoB, () => servicio.catalogo())).categorias).toEqual([]);
    });

    it('el banco B no edita ni desactiva lo del banco A: responde 404', async () => {
      const { cereales, arroz, kilo } = await catalogoDePrueba();

      await expect(enBanco(bancoB, () => servicio.desactivarReferencia(kilo.id))).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        enBanco(bancoB, () => servicio.editarProducto(arroz.id, { nombre: 'Robado' })),
      ).rejects.toThrow(NotFoundException);
      await expect(
        enBanco(bancoB, () => servicio.desactivarCategoria(cereales.id)),
      ).rejects.toThrow(NotFoundException);

      const intacta = await enBanco(bancoA, () => servicio.buscar({ texto: 'arroz 1' }));
      expect(intacta.map((r) => r.id)).toEqual([kilo.id]);
    });

    it('el banco B no cuelga productos ni presentaciones de lo del banco A', async () => {
      const { cereales, arroz } = await catalogoDePrueba();

      await expect(
        enBanco(bancoB, () =>
          servicio.crearProducto({ categoriaId: cereales.id, nombre: 'Arroz' }),
        ),
      ).rejects.toThrow('No existe esa categoría.');
      await expect(
        enBanco(bancoB, () =>
          servicio.crearReferencia({
            productoId: arroz.id,
            presentacion: '2 kg',
            equivalenciaKg: 2,
          }),
        ),
      ).rejects.toThrow('No existe ese producto.');
    });

    it('el banco B no mueve lo suyo bajo una categoría o un producto del banco A: responde 404', async () => {
      const { cereales, arroz } = await catalogoDePrueba();
      const deB = await enBanco(bancoB, async () => {
        const categoria = await servicio.crearCategoria({ codigo: 'C804', nombre: 'Plátanos' });
        const producto = await servicio.crearProducto({
          categoriaId: categoria.id,
          nombre: 'Plátano',
        });
        const referencia = await servicio.crearReferencia({
          productoId: producto.id,
          presentacion: '500 g',
          equivalenciaKg: 0.5,
        });
        return { categoria, producto, referencia };
      });

      await expect(
        enBanco(bancoB, () =>
          servicio.editarProducto(deB.producto.id, { categoriaId: cereales.id }),
        ),
      ).rejects.toThrow('No existe esa categoría.');
      await expect(
        enBanco(bancoB, () =>
          servicio.editarReferencia(deB.referencia.id, { productoId: arroz.id }),
        ),
      ).rejects.toThrow('No existe ese producto.');

      const intacta = await enBanco(bancoB, () => servicio.buscar({ texto: 'plátano' }));
      expect(intacta.map((r) => [r.id, r.producto.id, r.categoria.id])).toEqual([
        [deB.referencia.id, deB.producto.id, deB.categoria.id],
      ]);
      expect(await enBanco(bancoA, () => servicio.buscar({ texto: 'arroz' }))).toHaveLength(3);
    });

    it('el banco B crea su propio C801 y su propio «Arroz» aunque el banco A ya los tenga', async () => {
      await catalogoDePrueba();

      const encontradas = await enBanco(bancoB, async () => {
        const categoria = await servicio.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
        const producto = await servicio.crearProducto({
          categoriaId: categoria.id,
          nombre: 'Arroz',
        });
        await servicio.crearReferencia({
          productoId: producto.id,
          presentacion: '1 kg',
          equivalenciaKg: 1,
        });
        return servicio.buscar({ texto: 'c801' });
      });

      expect(
        encontradas.map((r) => `${r.categoria.codigo} ${r.producto.nombre} ${r.presentacion}`),
      ).toEqual(['C801 Arroz 1 kg']);
    });
  });
});
