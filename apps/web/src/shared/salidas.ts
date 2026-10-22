/**
 * Lo que manda y lo que recibe `POST /salidas` (SBA-38). `comandoId` y cada
 * `movimientoId` los genera el celular (UUIDv7): reenviar el mismo comando no
 * descuenta dos veces.
 */
export interface ComandoDeSalida {
  comandoId: string;
  institucionId: string;
  bodegaId: string;
  despachador: string;
  despachadorTipo: 'funcionario' | 'voluntario';
  detalles: { movimientoId: string; referenciaId: string; loteId: string; cantidad: string }[];
}

export interface DetalleDeSalida {
  movimientoId: string;
  referenciaId: string;
  categoriaId: string;
  loteId: string;
  cantidad: string;
  kilos: string;
  /** Sin precio aprobado vigente queda pendiente, nunca en cero (ADR-13). */
  valoracion: 'pendiente' | 'con_precio';
  valorUnitario: string | null;
  fuente: string | null;
  valorComercial: string | null;
  aporte: string | null;
}

export interface Salida {
  id: string;
  institucionId: string;
  bodegaId: string;
  despachador: string;
  despachadorTipo: 'funcionario' | 'voluntario';
  aportePct: string | null;
  registradaEn: string;
  detalles: DetalleDeSalida[];
}

export interface InstitucionActiva {
  id: string;
  nombre: string;
}

/** Lo que responde la API con 409 `sin_stock`: cada lote que no alcanza. */
export interface Faltante {
  loteId: string;
  referenciaId: string;
  solicitado: string;
  disponible: string;
}
