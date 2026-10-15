import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  executeTransactionWithTenant,
  IdempotenciaService,
  PrismaService,
} from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import {
  type AltaDesdeCelular,
  type BusquedaDeReferencias,
  type BusquedaDeSimilares,
  type CambiosEnCategoria,
  type CambiosEnProducto,
  type CambiosEnReferencia,
  type Categoria,
  type CategoriaDelCatalogo,
  type DatosDeCategoria,
  type DatosDeProducto,
  type DatosDeReferencia,
  type Producto,
  type ReferenciaDelCatalogo,
  ReferenciasRepositorio,
} from '../services/referencia.js';

const COLUMNAS_DE_CATEGORIA = {
  id: true,
  codigo: true,
  nombre: true,
  linea: true,
  descripcion: true,
  activa: true,
} as const;

const COLUMNAS_DE_PRODUCTO = { id: true, categoriaId: true, nombre: true, activo: true } as const;

const COLUMNAS_DE_REFERENCIA = {
  id: true,
  presentacion: true,
  equivalenciaKg: true,
  creadaDesdeCelular: true,
  activa: true,
  producto: {
    select: {
      id: true,
      nombre: true,
      categoria: { select: { id: true, codigo: true, nombre: true, linea: true } },
    },
  },
} as const;

const COLUMNAS_DEL_CATALOGO = {
  id: true,
  codigo: true,
  nombre: true,
  linea: true,
  descripcion: true,
  productos: {
    where: { activo: true },
    orderBy: { nombre: 'asc' },
    select: {
      id: true,
      nombre: true,
      referencias: {
        where: { activa: true },
        orderBy: [{ equivalenciaKg: 'asc' }, { presentacion: 'asc' }],
        select: {
          id: true,
          presentacion: true,
          equivalenciaKg: true,
          creadaDesdeCelular: true,
        },
      },
    },
  },
} satisfies Prisma.CategoriaSelect;

type FilaDelCatalogo = Prisma.CategoriaGetPayload<{ select: typeof COLUMNAS_DEL_CATALOGO }>;

type FilaDeReferencia = Prisma.ReferenciaGetPayload<{ select: typeof COLUMNAS_DE_REFERENCIA }>;

/** Lo que responde el motor cuando una restricción rechaza la escritura. */
interface Rechazos {
  duplicado: string;
  sinPadre?: string;
}

/**
 * Adaptador de Prisma para el catálogo. Todo pasa por
 * `executeTransactionWithTenant`: fuera de ella RLS deja cada consulta en cero
 * filas. Las consultas filtran además por `banco_id`, porque en local
 * `DATABASE_URL` suele ser superusuario y se salta RLS.
 */
@Injectable()
export class ReferenciasPrismaRepositorio extends ReferenciasRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
    private readonly idempotencia: IdempotenciaService,
  ) {
    super();
  }

  async buscar({
    palabras,
    categoriaId,
    soloActivas,
    limite,
  }: BusquedaDeReferencias): Promise<ReferenciaDelCatalogo[]> {
    const { bancoId } = contexto();

    return executeTransactionWithTenant<ReferenciaDelCatalogo[]>(this.prisma, async (tx) => {
      // Prisma no compara con una función de la base, así que el filtro va en
      // SQL con la misma normalización de los índices únicos: «arroz» encuentra
      // «Arróz».
      const filtros = [Prisma.sql`r."banco_id" = ${bancoId}::uuid`];
      if (soloActivas) filtros.push(Prisma.sql`r."activa" AND p."activo" AND c."activa"`);
      if (categoriaId) filtros.push(Prisma.sql`p."categoria_id" = ${categoriaId}::uuid`);
      for (const palabra of palabras) {
        filtros.push(Prisma.sql`(
          strpos(inventario.normalizar(r."presentacion"), inventario.normalizar(${palabra})) > 0
          OR strpos(inventario.normalizar(p."nombre"), inventario.normalizar(${palabra})) > 0
          OR inventario.normalizar(c."codigo") = inventario.normalizar(${palabra})
        )`);
      }

      // Termina en id: con el corte de `limite`, un empate dejaría que la lista
      // cambie entre dos pulsaciones.
      const idsOrdenados = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT r."id"
        FROM "inventario"."referencia" r
        JOIN "inventario"."producto" p
          ON p."banco_id" = r."banco_id" AND p."id" = r."producto_id"
        JOIN "inventario"."categoria" c
          ON c."banco_id" = p."banco_id" AND c."id" = p."categoria_id"
        WHERE ${Prisma.join(filtros, ' AND ')}
        ORDER BY p."nombre", r."equivalencia_kg", r."presentacion", r."id"
        LIMIT ${limite}
      `);
      if (idsOrdenados.length === 0) return [];

      const filas = await tx.referencia.findMany({
        where: { bancoId, id: { in: idsOrdenados.map(({ id }) => id) } },
        select: COLUMNAS_DE_REFERENCIA,
      });
      const porId = new Map(filas.map((fila) => [fila.id, fila]));
      return idsOrdenados.flatMap(({ id }) => {
        const fila = porId.get(id);
        return fila ? [aReferencia(fila)] : [];
      });
    });
  }

  async catalogo(): Promise<CategoriaDelCatalogo[]> {
    const { bancoId } = contexto();

    // El orden es total (termina en id) porque la versión del catálogo es un
    // hash: el mismo contenido tiene que salir siempre en el mismo orden.
    const categorias = await executeTransactionWithTenant<FilaDelCatalogo[]>(this.prisma, (tx) =>
      tx.categoria.findMany({
        where: { bancoId, activa: true },
        orderBy: [{ linea: 'asc' }, { codigo: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
        select: COLUMNAS_DEL_CATALOGO,
      }),
    );

    return categorias.map((categoria) => ({
      ...categoria,
      productos: categoria.productos.map((producto) => ({
        ...producto,
        referencias: producto.referencias.map((r) => ({
          ...r,
          equivalenciaKg: r.equivalenciaKg.toString(),
        })),
      })),
    }));
  }

  async crearCategoria(datos: DatosDeCategoria): Promise<Categoria> {
    const { bancoId, actor } = contexto();

    return escribir({ duplicado: 'Ya existe una categoría con ese código.' }, () =>
      executeTransactionWithTenant<Categoria>(this.prisma, async (tx) => {
        const categoria = await tx.categoria.create({
          data: { ...datos, bancoId, creadoPor: actor, actualizadoPor: actor },
          select: COLUMNAS_DE_CATEGORIA,
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'categoria',
          entidadId: categoria.id,
        });
        return categoria;
      }),
    );
  }

  async actualizarCategoria(id: string, cambios: CambiosEnCategoria): Promise<Categoria | null> {
    const { bancoId, actor } = contexto();

    return escribir({ duplicado: 'Ya existe una categoría con ese código.' }, () =>
      executeTransactionWithTenant<Categoria | null>(this.prisma, async (tx) => {
        // updateMany y no update: con RLS, un id de otro banco no es un error
        // sino cero filas.
        const { count } = await tx.categoria.updateMany({
          where: { id, bancoId },
          data: { ...cambios, actualizadoPor: actor },
        });
        if (count === 0) return null;
        const categoria = await tx.categoria.findUniqueOrThrow({
          where: { id },
          select: COLUMNAS_DE_CATEGORIA,
        });
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'categoria',
          entidadId: categoria.id,
        });
        return categoria;
      }),
    );
  }

  async crearProducto(datos: DatosDeProducto): Promise<Producto> {
    const { bancoId, actor } = contexto();

    return escribir(RECHAZOS_DE_PRODUCTO, () =>
      executeTransactionWithTenant<Producto>(this.prisma, async (tx) => {
        await exigirCategoriaActiva(tx, bancoId, datos.categoriaId);
        const producto = await tx.producto.create({
          data: { ...datos, bancoId, creadoPor: actor, actualizadoPor: actor },
          select: COLUMNAS_DE_PRODUCTO,
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'producto',
          entidadId: producto.id,
        });
        return producto;
      }),
    );
  }

  async actualizarProducto(id: string, cambios: CambiosEnProducto): Promise<Producto | null> {
    const { bancoId, actor } = contexto();

    return escribir(RECHAZOS_DE_PRODUCTO, () =>
      executeTransactionWithTenant<Producto | null>(this.prisma, async (tx) => {
        if (cambios.categoriaId !== undefined) {
          const actual = await tx.producto.findFirst({
            where: { id, bancoId },
            select: { categoriaId: true },
          });
          if (!actual) return null;
          // Reenviar la categoría que ya tiene no mueve el producto.
          if (actual.categoriaId !== cambios.categoriaId) {
            await exigirCategoriaActiva(tx, bancoId, cambios.categoriaId);
          }
        }
        const { count } = await tx.producto.updateMany({
          where: { id, bancoId },
          data: { ...cambios, actualizadoPor: actor },
        });
        if (count === 0) return null;
        const producto = await tx.producto.findUniqueOrThrow({
          where: { id },
          select: COLUMNAS_DE_PRODUCTO,
        });
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'producto',
          entidadId: producto.id,
        });
        return producto;
      }),
    );
  }

  async crearReferencia(datos: DatosDeReferencia): Promise<ReferenciaDelCatalogo> {
    const { bancoId, actor } = contexto();

    const fila = await escribir(RECHAZOS_DE_REFERENCIA, () =>
      executeTransactionWithTenant<FilaDeReferencia>(this.prisma, async (tx) => {
        await exigirProductoActivo(tx, bancoId, datos.productoId);
        const referencia = await tx.referencia.create({
          data: { ...datos, bancoId, creadoPor: actor, actualizadoPor: actor },
          select: COLUMNAS_DE_REFERENCIA,
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'referencia',
          entidadId: referencia.id,
        });
        return referencia;
      }),
    );
    return aReferencia(fila);
  }

  async crearDesdeCelular(
    comandoId: string,
    datos: Omit<DatosDeReferencia, 'creadaDesdeCelular'>,
  ): Promise<AltaDesdeCelular> {
    const { bancoId, actor } = contexto();
    // El id se genera antes: la reserva del comando guarda el de la referencia.
    const id = randomUUID();

    return escribir(RECHAZOS_DE_REFERENCIA, () =>
      executeTransactionWithTenant<AltaDesdeCelular>(this.prisma, async (tx) => {
        const previo = await this.idempotencia.reclamar(tx, {
          comandoId,
          carga: datos,
          resultado: { entidad: 'referencia', entidadId: id },
        });
        if (previo) {
          const fila = await tx.referencia.findUniqueOrThrow({
            where: { id: previo.entidadId },
            select: COLUMNAS_DE_REFERENCIA,
          });
          return { referencia: aReferencia(fila), repetida: true };
        }

        await exigirProductoActivo(tx, bancoId, datos.productoId);
        const fila = await tx.referencia.create({
          data: {
            ...datos,
            id,
            bancoId,
            creadaDesdeCelular: true,
            creadoPor: actor,
            actualizadoPor: actor,
          },
          select: COLUMNAS_DE_REFERENCIA,
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'referencia',
          entidadId: id,
        });
        return { referencia: aReferencia(fila), repetida: false };
      }),
    );
  }

  async similares({
    productoId,
    presentacion,
    equivalenciaKg,
  }: BusquedaDeSimilares): Promise<ReferenciaDelCatalogo[]> {
    const { bancoId } = contexto();

    return executeTransactionWithTenant<ReferenciaDelCatalogo[]>(this.prisma, async (tx) => {
      const parecidas = [];
      if (equivalenciaKg)
        parecidas.push(Prisma.sql`r."equivalencia_kg" = ${equivalenciaKg}::numeric`);
      if (presentacion) {
        parecidas.push(Prisma.sql`(
          strpos(inventario.normalizar(r."presentacion"), inventario.normalizar(${presentacion})) > 0
          OR strpos(inventario.normalizar(${presentacion}), inventario.normalizar(r."presentacion")) > 0
        )`);
      }
      if (parecidas.length === 0) return [];

      const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT r."id"
        FROM "inventario"."referencia" r
        WHERE r."banco_id" = ${bancoId}::uuid
          AND r."producto_id" = ${productoId}::uuid
          AND r."activa"
          AND (${Prisma.join(parecidas, ' OR ')})
        ORDER BY r."equivalencia_kg", r."presentacion", r."id"
      `);
      if (ids.length === 0) return [];

      const filas = await tx.referencia.findMany({
        where: { bancoId, id: { in: ids.map(({ id }) => id) } },
        orderBy: [{ equivalenciaKg: 'asc' }, { presentacion: 'asc' }, { id: 'asc' }],
        select: COLUMNAS_DE_REFERENCIA,
      });
      return filas.map(aReferencia);
    });
  }

  async actualizarReferencia(
    id: string,
    cambios: CambiosEnReferencia,
  ): Promise<ReferenciaDelCatalogo | null> {
    const { bancoId, actor } = contexto();

    const fila = await escribir(RECHAZOS_DE_REFERENCIA, () =>
      executeTransactionWithTenant<FilaDeReferencia | null>(this.prisma, async (tx) => {
        if (cambios.productoId !== undefined) {
          const actual = await tx.referencia.findFirst({
            where: { id, bancoId },
            select: { productoId: true },
          });
          if (!actual) return null;
          // Reenviar el producto que ya tiene no mueve la presentación.
          if (actual.productoId !== cambios.productoId) {
            await exigirProductoActivo(tx, bancoId, cambios.productoId);
          }
        }
        const { count } = await tx.referencia.updateMany({
          where: { id, bancoId },
          data: { ...cambios, actualizadoPor: actor },
        });
        if (count === 0) return null;
        const referencia = await tx.referencia.findUniqueOrThrow({
          where: { id },
          select: COLUMNAS_DE_REFERENCIA,
        });
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'referencia',
          entidadId: referencia.id,
        });
        return referencia;
      }),
    );
    return fila && aReferencia(fila);
  }
}

const RECHAZOS_DE_PRODUCTO: Rechazos = {
  duplicado: 'Ya existe un producto con ese nombre.',
  sinPadre: 'No existe esa categoría.',
};

const RECHAZOS_DE_REFERENCIA: Rechazos = {
  duplicado: 'Ese producto ya tiene esa presentación.',
  sinPadre: 'No existe ese producto.',
};

/**
 * Lo que cuelga de una categoría desactivada no aparece en la búsqueda ni en el
 * catálogo, así que se rechaza con 409. Si la categoría no existe en el banco,
 * la FK compuesta rechaza la escritura y sale como 404.
 *
 * No bloquea la fila: si otra transacción la desactiva justo después, queda
 * como desactivar una categoría que ya tenía productos, que está permitido.
 */
async function exigirCategoriaActiva(
  tx: Prisma.TransactionClient,
  bancoId: string,
  id: string,
): Promise<void> {
  const categoria = await tx.categoria.findFirst({
    where: { id, bancoId },
    select: { activa: true },
  });
  if (categoria?.activa === false) {
    throw new ConflictException(
      'La categoría está desactivada. Reactívala antes de agregarle productos.',
    );
  }
}

/**
 * Igual que `exigirCategoriaActiva`, un nivel abajo. La categoría del producto
 * también cuenta: si está desactivada, la búsqueda oculta sus presentaciones.
 */
async function exigirProductoActivo(
  tx: Prisma.TransactionClient,
  bancoId: string,
  id: string,
): Promise<void> {
  const producto = await tx.producto.findFirst({
    where: { id, bancoId },
    select: { activo: true, categoria: { select: { activa: true } } },
  });
  if (producto?.activo === false) {
    throw new ConflictException(
      'El producto está desactivado. Reactívalo antes de agregarle presentaciones.',
    );
  }
  if (producto?.categoria.activa === false) {
    throw new ConflictException(
      'La categoría de ese producto está desactivada. Reactívala antes de agregarle presentaciones.',
    );
  }
}

/**
 * Traduce las restricciones del motor. Las FK son compuestas con `banco_id`,
 * así que un padre de otro banco sale igual que uno que no existe.
 */
async function escribir<T>(rechazos: Rechazos, escritura: () => Promise<T>): Promise<T> {
  try {
    return await escritura();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException(rechazos.duplicado);
      if (error.code === 'P2003' && rechazos.sinPadre) {
        throw new NotFoundException(rechazos.sinPadre);
      }
    }
    throw error;
  }
}

function aReferencia({ producto, equivalenciaKg, ...referencia }: FilaDeReferencia) {
  const { categoria, ...resto } = producto;
  return {
    ...referencia,
    equivalenciaKg: equivalenciaKg.toString(),
    producto: resto,
    categoria,
  };
}
