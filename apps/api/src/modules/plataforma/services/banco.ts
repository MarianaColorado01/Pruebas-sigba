import type { BancoDto } from '@sigba/shared-types';

/**
 * Banco de la red y el puerto por el que se guarda (SBA-19, D11).
 *
 * Solo `super_admin` escribe bancos y su asignación no tiene banco. El
 * adaptador fija `app.banco_id` al banco que escribe (D7), para que la
 * auditoría y las políticas de `banco` lo encuentren.
 */

export type Banco = BancoDto;

export type DatosDeBanco = Pick<Banco, 'nombre' | 'codigo'>;

export type CambiosEnBanco = Partial<Omit<Banco, 'id'>>;

/**
 * Ya existe un banco con ese código. En el alta, `existente` es el banco que
 * choca (el servicio decide si es un reenvío igual); en la edición es `null`.
 */
export class CodigoDeBancoRepetido extends Error {
  constructor(readonly existente: Banco | null = null) {
    super();
  }
}

export abstract class BancosRepositorio {
  /** Lo cuelga de la red ABACO, la única (D12). @throws CodigoDeBancoRepetido */
  abstract crear(datos: DatosDeBanco): Promise<Banco>;

  /** Todos los de la red, activos o no, por nombre. */
  abstract listar(): Promise<Banco[]>;

  /** `null` si no existe. @throws CodigoDeBancoRepetido */
  abstract actualizar(id: string, cambios: CambiosEnBanco): Promise<Banco | null>;
}
