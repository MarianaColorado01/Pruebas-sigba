import { Injectable } from '@nestjs/common';
import { executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import { contexto } from './contexto-de-tenant.js';
import {
  type CategoriaDelBanco,
  CategoriasRepositorio,
  type ResultadoDeGuardado,
} from '../services/categoria.js';

/**
 * Adaptador de Prisma para las categorías del Banco. Todo pasa por
 * `executeTransactionWithTenant`: fuera de ella RLS deja cada consulta en cero
 * filas. Las consultas filtran además por `banco_id`: el comando corre con
 * `DATABASE_URL`, y en local ese usuario es superusuario y se salta RLS.
 */
@Injectable()
export class CategoriasPrismaRepositorio extends CategoriasRepositorio {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async guardar(categorias: CategoriaDelBanco[]): Promise<ResultadoDeGuardado> {
    const { bancoId, actor } = contexto();

    // Una sola transacción: si una fila falla, no queda media hoja importada.
    return executeTransactionWithTenant<ResultadoDeGuardado>(this.prisma, async (tx) => {
      const existentes = await tx.categoria.findMany({
        where: { bancoId, codigo: { in: categorias.map((c) => c.codigo) } },
        select: { codigo: true, nombre: true, linea: true, descripcion: true },
      });
      const porCodigo = new Map(existentes.map((e) => [e.codigo, e]));
      const resultado = { creadas: 0, actualizadas: 0, sinCambios: 0 };
      const nuevas = [];

      for (const categoria of categorias) {
        const actual = porCodigo.get(categoria.codigo);
        if (!actual) {
          nuevas.push({ ...categoria, bancoId, creadoPor: actor, actualizadoPor: actor });
          resultado.creadas++;
        } else if (
          actual.nombre === categoria.nombre &&
          (categoria.linea === undefined || actual.linea === categoria.linea) &&
          (categoria.descripcion === undefined || actual.descripcion === categoria.descripcion)
        ) {
          resultado.sinCambios++;
        } else {
          // Prisma omite los campos undefined: una columna que el archivo no
          // trae no borra el valor guardado.
          await tx.categoria.update({
            where: { bancoId_codigo: { bancoId, codigo: categoria.codigo } },
            data: { ...categoria, actualizadoPor: actor },
          });
          resultado.actualizadas++;
        }
      }

      await tx.categoria.createMany({ data: nuevas });
      return resultado;
    });
  }

  async productosSinCodigo(): Promise<string[]> {
    const { bancoId } = contexto();

    const productos = await executeTransactionWithTenant<{ nombre: string }[]>(this.prisma, (tx) =>
      tx.producto.findMany({
        where: { bancoId, categoria: { codigo: null } },
        select: { nombre: true },
        orderBy: { nombre: 'asc' },
      }),
    );
    return productos.map((p) => p.nombre);
  }
}
