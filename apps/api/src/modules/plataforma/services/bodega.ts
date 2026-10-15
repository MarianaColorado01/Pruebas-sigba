/**
 * Bodega del banco y el puerto por el que se lee (SBA-34).
 *
 * Plataforma es dueña de `plataforma.bodega`. Los demás módulos guardan solo el
 * id, sin FK entre schemas, y lo validan con `BodegasService` (ADR-05).
 */

export interface Bodega {
  id: string;
  nombre: string;
}

export abstract class BodegasRepositorio {
  /** `null` si el banco del contexto no tiene esa bodega o está desactivada. */
  abstract activa(id: string): Promise<Bodega | null>;
}
