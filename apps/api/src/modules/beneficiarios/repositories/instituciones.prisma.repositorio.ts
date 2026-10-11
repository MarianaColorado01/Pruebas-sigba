import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService, executeTransactionWithTenant, PrismaService } from '../../../core/index.js';
import { contextoDeEscritura } from './contexto-de-tenant.js';
import {
  type BusquedaDeInstituciones,
  type CambiosEnInstitucion,
  type DatosDeInstitucion,
  type Institucion,
  InstitucionesRepositorio,
  NombreDeInstitucionRepetido,
  TipoDePoblacionInexistente,
} from '../services/institucion.js';

const COLUMNAS = {
  id: true,
  nombre: true,
  tipo: true,
  contactoNombre: true,
  contactoTelefono: true,
  contactoCorreo: true,
  direccion: true,
  diaRecogida: true,
  tipoPoblacionId: true,
  activa: true,
  actualizadoPor: true,
  actualizadoEn: true,
} as const;

/** Violación de UNIQUE y de FOREIGN KEY en PostgreSQL, según Prisma. */
const UNICIDAD_VIOLADA = 'P2002';
const LLAVE_FORANEA_VIOLADA = 'P2003';

/**
 * Adaptador de Prisma para el directorio de instituciones. Todo pasa por
 * `executeTransactionWithTenant`: fuera de ella RLS deja cada consulta en cero
 * filas.
 */
@Injectable()
export class InstitucionesPrismaRepositorio extends InstitucionesRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
  ) {
    super();
  }

  async crear(datos: DatosDeInstitucion): Promise<Institucion> {
    const { bancoId, actor } = contextoDeEscritura();

    return this.traducirErrores(() =>
      executeTransactionWithTenant<Institucion>(this.prisma, async (tx) => {
        const institucion = await tx.institucion.create({
          data: { ...datos, bancoId, actualizadoPor: actor, actualizadoEn: new Date() },
          select: COLUMNAS,
        });
        await this.auditoria.registrar(tx, {
          accion: 'crear',
          entidad: 'institucion',
          entidadId: institucion.id,
        });
        return institucion;
      }),
    );
  }

  async buscar({ texto, tipo, soloActivas }: BusquedaDeInstituciones): Promise<Institucion[]> {
    return executeTransactionWithTenant<Institucion[]>(this.prisma, (tx) =>
      tx.institucion.findMany({
        where: {
          ...(texto && { nombre: { contains: texto, mode: 'insensitive' as const } }),
          ...(tipo && { tipo }),
          ...(soloActivas && { activa: true }),
        },
        orderBy: { nombre: 'asc' },
        select: COLUMNAS,
      }),
    );
  }

  async actualizar(id: string, cambios: CambiosEnInstitucion): Promise<Institucion | null> {
    const { actor } = contextoDeEscritura();

    return this.traducirErrores(() =>
      executeTransactionWithTenant<Institucion | null>(this.prisma, async (tx) => {
        // updateMany y no update: con RLS, un id de otro banco no es un error
        // sino cero filas.
        const { count } = await tx.institucion.updateMany({
          where: { id },
          data: { ...cambios, actualizadoPor: actor, actualizadoEn: new Date() },
        });
        if (count === 0) return null;
        const institucion = await tx.institucion.findUniqueOrThrow({
          where: { id },
          select: COLUMNAS,
        });
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'institucion',
          entidadId: institucion.id,
        });
        return institucion;
      }),
    );
  }

  private async traducirErrores<R>(operacion: () => Promise<R>): Promise<R> {
    try {
      return await operacion();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === UNICIDAD_VIOLADA) throw new NombreDeInstitucionRepetido();
        if (error.code === LLAVE_FORANEA_VIOLADA) throw new TipoDePoblacionInexistente();
      }
      throw error;
    }
  }
}
