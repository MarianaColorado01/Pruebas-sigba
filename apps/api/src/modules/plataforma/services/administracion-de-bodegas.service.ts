import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type FichaDeBodega,
  AdministracionDeBodegasRepositorio,
  BodegaConStock,
  type CambiosEnBodega,
  NombreDeBodegaRepetido,
} from './bodega.js';
import { opcional, requerido } from './texto.js';

const LARGO_NOMBRE = 80;
const LARGO_DIRECCION = 200;

export interface NuevaBodega {
  nombre: string;
  direccion?: string | null;
}

export type EdicionDeBodega = Partial<NuevaBodega>;

/**
 * Bodegas del banco, del lado de `admin_banco` (SBA-19, D10).
 *
 * Una bodega no se borra: `inventario.recepcion` guarda su id sin FK entre
 * schemas. Se desactiva, deja de ofrecerse para movimientos nuevos y su stock
 * sigue visible. Otros módulos leen con `BodegasService` (SBA-34), que va
 * por `BodegasRepositorio` sobre la misma tabla.
 *
 * El alta no lleva `comandoId`: se hace en línea desde la web y su llave
 * natural es el nombre dentro del banco. Reenviar la misma bodega devuelve la
 * existente (`repetida`); el mismo nombre con otros datos es un 409.
 */
@Injectable()
export class AdministracionDeBodegasService {
  constructor(private readonly repositorio: AdministracionDeBodegasRepositorio) {}

  async crear(nueva: NuevaBodega): Promise<{ bodega: FichaDeBodega; repetida: boolean }> {
    const datos = {
      nombre: nombreValido(nueva.nombre),
      direccion: direccionValida(nueva.direccion),
    };
    try {
      return { bodega: await this.repositorio.crear(datos), repetida: false };
    } catch (error) {
      const existente = error instanceof NombreDeBodegaRepetido ? error.existente : null;
      if (
        existente?.activa &&
        existente.nombre === datos.nombre &&
        existente.direccion === datos.direccion
      ) {
        return { bodega: existente, repetida: true };
      }
      conflicto(error);
    }
  }

  async listar(filtro: { incluirInactivas?: boolean } = {}): Promise<FichaDeBodega[]> {
    return this.repositorio.listar({ soloActivas: !filtro.incluirInactivas });
  }

  async editar(id: string, edicion: EdicionDeBodega): Promise<FichaDeBodega> {
    const cambios: CambiosEnBodega = {};
    if (edicion.nombre !== undefined) cambios.nombre = nombreValido(edicion.nombre);
    if (edicion.direccion !== undefined) cambios.direccion = direccionValida(edicion.direccion);
    return this.actualizar(id, cambios);
  }

  async desactivar(id: string): Promise<FichaDeBodega> {
    return this.actualizar(id, { activa: false });
  }

  async reactivar(id: string): Promise<FichaDeBodega> {
    return this.actualizar(id, { activa: true });
  }

  private async actualizar(id: string, cambios: CambiosEnBodega): Promise<FichaDeBodega> {
    const bodega = await this.repositorio.actualizar(id, cambios).catch(conflicto);
    // RLS no distingue «no existe» de «es de otro banco», y la respuesta tampoco.
    if (!bodega) throw new NotFoundException('No existe esa bodega.');
    return bodega;
  }
}

function conflicto(error: unknown): never {
  if (error instanceof NombreDeBodegaRepetido)
    throw new ConflictException('Ya existe una bodega con ese nombre.');
  if (error instanceof BodegaConStock) {
    throw new ConflictException(
      'La bodega todavía tiene stock. Trasládalo o dalo de baja antes de desactivarla.',
    );
  }
  throw error;
}

function nombreValido(nombre: string): string {
  return requerido(nombre, LARGO_NOMBRE, 'El nombre de la bodega');
}

function direccionValida(direccion: string | null | undefined): string | null {
  return opcional(direccion, LARGO_DIRECCION, 'La dirección');
}
