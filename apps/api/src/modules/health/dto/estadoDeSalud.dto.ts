/**
 * Lo que responde `GET /api/v1/health`.
 *
 * Los DTO describen lo que cruza la frontera HTTP. TypeScript no valida JSON
 * externo: lo que entra se valida en ejecución con `class-validator` (ADR-04).
 * Este endpoint no recibe nada, así que solo declara la salida.
 */
export class EstadoDeSaludDto {
  /** `ok` mientras el proceso responda. */
  estado!: 'ok';

  /** Momento de la respuesta, en ISO 8601. */
  momento!: string;

  /** Segundos que lleva vivo el proceso. */
  tiempoEnPie!: number;
}
