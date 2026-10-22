import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MOTIVOS_DE_CIERRE_DE_MEMBRESIA,
  type MotivoDeCierreDeMembresia,
} from '@sigba/shared-types';
import { membresiaActivada, membresiaCerrada } from '../events/membresias.js';
import { type Membresia, RegistroRepositorio } from './registro.js';

/**
 * Cierre, traslado e historial de membresías (SBA-28, RF-M2-07, RF-M2-08).
 * El alta, que activa la membresía, está en `RegistroDeBeneficiariosService`.
 *
 * Una membresía cerrada no se reabre: quien vuelve recibe otra y la anterior
 * conserva su cierre (criterio 3). Las alertas abiertas que apuntan a la
 * membresía cerrada siguen abiertas hasta SBA-48 (esquema v5.0, sección 7.8).
 */
@Injectable()
export class MembresiasService {
  constructor(private readonly repositorio: RegistroRepositorio) {}

  async cerrar(membresiaId: string, motivo: MotivoDeCierreDeMembresia): Promise<Membresia> {
    // `traslado` lo pone solo el traslado de coordinación.
    if (!(MOTIVOS_DE_CIERRE_DE_MEMBRESIA as readonly string[]).includes(motivo)) {
      throw new BadRequestException(
        `Motivo de cierre desconocido. Debe ser uno de: ${MOTIVOS_DE_CIERRE_DE_MEMBRESIA.join(', ')}.`,
      );
    }
    return this.repositorio.enTransaccion(async (tx) => {
      const cerrada = await tx.cerrarMembresia(membresiaId, motivo);
      if (!cerrada) throw new NotFoundException('No hay una membresía activa con ese id.');
      await tx.emitir(membresiaCerrada(cerrada));
      return cerrada;
    });
  }

  /**
   * Cierra la membresía activa con motivo `traslado` y abre otra en
   * `institucionId`, en la misma transacción (criterio 2). Solo coordinación:
   * lo exige el controlador.
   */
  async trasladar(beneficiarioId: string, institucionId: string): Promise<Membresia> {
    return this.repositorio.enTransaccion(async (tx) => {
      const activa = await tx.membresiaActiva(beneficiarioId);
      if (!activa) throw new NotFoundException('La persona no tiene membresía activa.');
      if (activa.institucionId === institucionId) {
        throw new ConflictException('La persona ya está en esa institución.');
      }
      if (!(await tx.institucionActiva(institucionId))) {
        throw new NotFoundException('No existe esa institución o está desactivada.');
      }

      const cerrada = await tx.cerrarMembresia(activa.id, 'traslado');
      // Otra escritura la cerró entre la lectura y el UPDATE.
      if (!cerrada) throw new ConflictException('La membresía cambió. Intenta de nuevo.');
      await tx.emitir(membresiaCerrada(cerrada));
      const nueva = await tx.crearMembresia(beneficiarioId, institucionId);
      await tx.emitir(membresiaActivada(nueva));
      return nueva;
    });
  }

  async historial(beneficiarioId: string): Promise<Membresia[]> {
    const membresias = await this.repositorio.historial(beneficiarioId);
    if (!membresias) throw new NotFoundException('No existe ese beneficiario.');
    return membresias;
  }
}
