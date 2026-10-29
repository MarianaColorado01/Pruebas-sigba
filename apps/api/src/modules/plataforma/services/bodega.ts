import type { BodegaDto, BodegaLectura } from '@sigba/shared-types';

/**
 * Bodega del banco y los dos puertos por los que se lee y se administra.
 *
 * Plataforma es dueña de `plataforma.bodega`. Los demás módulos guardan solo el
 * id, sin FK entre schemas, y lo validan con `BodegasService` (ADR-05,
 * SBA-34). `admin_banco` la administra con `AdministracionDeBodegasService`
 * (SBA-19, D10).
 *
 * El adaptador de Prisma vive en `repositories/` y pone el banco y el actor
 * desde el contexto de tenant, igual que RLS: no viajan por aquí.
 */

/** Lo que otro módulo necesita de una bodega. */
export interface Bodega {
  id: string;
  nombre: string;
}

export abstract class BodegasRepositorio {
  /** `null` si el banco del contexto no tiene esa bodega o está desactivada. */
  abstract activa(id: string): Promise<Bodega | null>;

  /** Las activas del banco del contexto, por nombre y luego por id. */
  abstract activas(): Promise<BodegaLectura[]>;

  /** Activa o no; `null` si el banco del contexto no tiene esa bodega. */
  abstract porId(id: string): Promise<BodegaLectura | null>;
}

/** La bodega completa, como la administra `admin_banco`. */
export type FichaDeBodega = BodegaDto;

export type DatosDeBodega = Pick<FichaDeBodega, 'nombre' | 'direccion'>;

export type CambiosEnBodega = Partial<Omit<FichaDeBodega, 'id'>>;

/**
 * Ya existe otra bodega con ese nombre en el banco, sin importar mayúsculas.
 * En el alta, `existente` es la bodega que choca (el servicio decide si es un
 * reenvío igual); en la edición es `null`.
 */
export class NombreDeBodegaRepetido extends Error {
  constructor(readonly existente: FichaDeBodega | null = null) {
    super();
  }
}

/**
 * La bodega todavía tiene saldo y no se puede desactivar (SBA-76). Lo rechaza
 * un trigger de la base: primero se traslada o se da de baja lo que queda.
 */
export class BodegaConStock extends Error {}

export abstract class AdministracionDeBodegasRepositorio {
  /** @throws NombreDeBodegaRepetido */
  abstract crear(datos: DatosDeBodega): Promise<FichaDeBodega>;

  /** Las del banco del contexto, por nombre. */
  abstract listar(filtro: { soloActivas: boolean }): Promise<FichaDeBodega[]>;

  /**
   * `null` si la bodega no existe en el banco del contexto.
   *
   * @throws NombreDeBodegaRepetido
   */
  abstract actualizar(id: string, cambios: CambiosEnBodega): Promise<FichaDeBodega | null>;
}
