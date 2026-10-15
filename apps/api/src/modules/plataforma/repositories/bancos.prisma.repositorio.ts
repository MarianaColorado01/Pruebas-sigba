import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuditService,
  executeTransactionWithTenant,
  getTenantContext,
  PrismaService,
  type TenantContext,
} from '../../../core/index.js';
import {
  type Banco,
  BancosRepositorio,
  type CambiosEnBanco,
  CodigoDeBancoRepetido,
  type DatosDeBanco,
} from '../services/banco.js';

/** La única red (D12). La crea la migración de SBA-19. */
export const RED_ABACO = '00000000-0000-4000-8000-00000000abac';

const COLUMNAS = { id: true, nombre: true, codigo: true, activo: true } as const;

/** Violación de UNIQUE en PostgreSQL, según Prisma. */
const UNICIDAD_VIOLADA = 'P2002';

/**
 * El contexto de la petición, pero en el banco que se escribe (D7). La
 * asignación de `super_admin` no tiene banco; sin `app.banco_id`, ni la
 * auditoría ni las políticas de `banco` dejan escribir.
 */
function enElBanco(bancoId: string): TenantContext {
  const ctx = getTenantContext();
  if (!ctx?.usuarioId) {
    throw new Error('Escritura de banco sin usuario en el contexto de tenant.');
  }
  return { usuarioId: ctx.usuarioId, bancoId };
}

/**
 * Adaptador de Prisma para los bancos de la red. La base comprueba otra vez
 * que quien escribe es `super_admin` (políticas `banco_alta` y
 * `banco_edicion`): si el contexto es de otro rol, el alta falla y la edición
 * no toca filas.
 */
@Injectable()
export class BancosPrismaRepositorio extends BancosRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async crear(datos: DatosDeBanco): Promise<Banco> {
    // El id se elige antes para fijar app.banco_id con él antes del INSERT.
    const id = randomUUID();

    return traducirErrores(
      () =>
        executeTransactionWithTenant<Banco>(
          this.prisma,
          async (tx) => {
            const banco = await tx.banco.create({
              data: { id, redId: RED_ABACO, ...datos },
              select: COLUMNAS,
            });
            await this.auditoria.registrar(tx, {
              accion: 'crear',
              entidad: 'banco',
              entidadId: id,
            });
            return banco;
          },
          enElBanco(id),
        ),
      // La transacción abortada no se puede consultar: se lee en otra.
      () =>
        executeTransactionWithTenant<Banco | null>(this.prisma, (tx) =>
          tx.banco.findUnique({ where: { codigo: datos.codigo }, select: COLUMNAS }),
        ),
    );
  }

  async listar(): Promise<Banco[]> {
    return executeTransactionWithTenant<Banco[]>(this.prisma, (tx) =>
      tx.banco.findMany({ orderBy: { nombre: 'asc' }, select: COLUMNAS }),
    );
  }

  async actualizar(id: string, cambios: CambiosEnBanco): Promise<Banco | null> {
    return traducirErrores(() =>
      executeTransactionWithTenant<Banco | null>(
        this.prisma,
        async (tx) => {
          const { count } = await tx.banco.updateMany({ where: { id }, data: cambios });
          if (count === 0) return null;
          await this.auditoria.registrar(tx, {
            accion: 'actualizar',
            entidad: 'banco',
            entidadId: id,
            detalle: { camposModificados: Object.keys(cambios) },
          });
          return tx.banco.findUniqueOrThrow({ where: { id }, select: COLUMNAS });
        },
        enElBanco(id),
      ),
    );
  }
}

async function traducirErrores<R>(
  operacion: () => Promise<R>,
  buscarExistente?: () => Promise<Banco | null>,
): Promise<R> {
  try {
    return await operacion();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNICIDAD_VIOLADA) {
      throw new CodigoDeBancoRepetido(buscarExistente ? await buscarExistente() : null);
    }
    throw error;
  }
}
