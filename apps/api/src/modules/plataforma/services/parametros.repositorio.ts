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
  constructor() {
    super('La fecha de inicio debe ser posterior a hoy y a la última versión.');
  }
}

export abstract class ParametrosRepositorio {
  abstract obtenerVigente<K extends ClaveParametro>(
    clave: K,
    fecha: string,
  ): Promise<ParametroVersion<K> | null>;

  abstract listarVigentes(fecha: string): Promise<ParametroVersion[]>;

  abstract historial(clave: ClaveParametro): Promise<ParametroVersion[]>;

  abstract actualizar<K extends ClaveParametro>(
    clave: K,
    valor: ValorParametro[K],
    fechaInicio: string,
  ): Promise<ParametroVersion<K>>;
}
