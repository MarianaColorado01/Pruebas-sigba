import { ConflictException } from '@nestjs/common';
import type { ClaveParametro, ValorParametro } from '@sigba/shared-types';

export interface ParametroVersion<K extends ClaveParametro = ClaveParametro> {
  id: string;
  clave: K;
  valor: ValorParametro[K];
  version: number;
  fechaInicio: string;
  fechaFin: string | null;
}

export class ConflictoDeVigencia extends ConflictException {
  constructor(mensaje = 'La fecha de inicio no puede ser anterior a hoy ni a la última versión.') {
    super(mensaje);
  }
}

export abstract class ParametrosRepositorio {
  abstract obtenerVigente<K extends ClaveParametro>(
    clave: K,
    fecha: string,
  ): Promise<ParametroVersion<K> | null>;

  /** Todas las versiones de `clave` vigentes en `fecha`; más de una son datos corruptos. */
  abstract vigentesEn<K extends ClaveParametro>(
    clave: K,
    fecha: string,
  ): Promise<ParametroVersion<K>[]>;

  abstract listarVigentes(fecha: string): Promise<ParametroVersion[]>;

  abstract historial(clave: ClaveParametro): Promise<ParametroVersion[]>;

  /**
   * Escribe una versión dentro de una sola transacción, siguiendo `decidirEscritura`.
   * `hoy` es la fecha de Bogotá (YYYY-MM-DD) con la que el servicio decide qué
   * versiones aún no empezaron.
   */
  abstract actualizar<K extends ClaveParametro>(
    clave: K,
    valor: ValorParametro[K],
    fechaInicio: string,
    hoy: string,
  ): Promise<ParametroVersion<K>>;
}
