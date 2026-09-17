import { Injectable } from '@nestjs/common';
import type { EstadoDeSaludDto } from '../dto/estadoDeSalud.dto.js';

/**
 * Lógica de dominio del módulo. Aquí es trivial, pero marca dónde va.
 *
 * `services/` se escribe con TDD y mantiene 70 % de cobertura como mínimo
 * (RNF-02). No importa SDK de proveedores: si necesitas Prisma, Auth0 o el
 * almacén de objetos, va detrás de un puerto de `core` y se usa desde
 * `repositories/` (RNF-03). El lint lo comprueba.
 */
@Injectable()
export class SaludService {
  /**
   * `ahora` entra por parámetro para que la prueba fije el momento sin parchear
   * `Date` global. No va en el constructor: Nest resuelve por tipo, y un tipo
   * función no le dice qué inyectar.
   */
  consultar(tiempoEnPieEnSegundos: number, ahora: Date = new Date()): EstadoDeSaludDto {
    return {
      estado: 'ok',
      momento: ahora.toISOString(),
      tiempoEnPie: Math.floor(tiempoEnPieEnSegundos),
    };
  }
}
