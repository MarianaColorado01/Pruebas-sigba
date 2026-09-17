/**
 * Contratos compartidos entre la API y la PWA: DTO, enums y eventos.
 *
 * Todo lo que cruza la frontera entre `apps/api` y `apps/web` vive aquí, para
 * que el tipo se defina una sola vez (Arquitectura 5.3). Los esquemas de los
 * ocho eventos de dominio llegan con SBA-30.
 *
 * Un cambio en este paquete es un cambio de contrato: exige revisión del
 * responsable de arquitectura y del equipo consumidor (Arquitectura 5.2).
 */

/** Versión del contrato. Sube con cada cambio incompatible. */
export const VERSION_DE_CONTRATOS = '0.0.0' as const;

/** Módulos funcionales del backend (Arquitectura 5.2). */
export const MODULOS = ['plataforma', 'inventario', 'beneficiarios', 'analitica'] as const;

export type Modulo = (typeof MODULOS)[number];
