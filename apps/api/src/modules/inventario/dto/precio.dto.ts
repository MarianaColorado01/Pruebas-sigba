import { Transform } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';

/**
 * Lo que entra por HTTP al maestro de precios (ADR-04). Aquí se comprueban la
 * forma y los tipos; UUID, pesos, banda, fuente y fechas los valida
 * `PreciosService`, que es lo que tiene pruebas y arma la carga del hash.
 */

/** Texto con punto decimal; un número también vale. */
const comoTexto = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

export class ProponerPrecioDto {
  @IsString()
  comandoId!: string;

  @IsString()
  referenciaId!: string;

  @Transform(comoTexto)
  @IsString()
  valor!: string;

  @Transform(comoTexto)
  @IsString()
  piso!: string;

  @Transform(comoTexto)
  @IsString()
  techo!: string;

  @IsString()
  fuente!: string;

  @IsString()
  evidencia!: string;

  /** AAAA-MM-DD. */
  @IsString()
  vigenteDesde!: string;

  /** AAAA-MM-DD; sin él, la vigencia dura lo que fija el servicio. */
  @IsOptional()
  @IsString()
  vigenteHasta?: string | null;
}

export class AprobarPrecioDto {
  @IsString()
  comandoId!: string;

  /** Obligatorio si el valor queda fuera de la banda de piso y techo. */
  @IsOptional()
  @IsString()
  motivoFueraDeBanda?: string | null;
}

export class PrecioVigenteDto {
  /** AAAA-MM-DD; sin ella, hoy en Colombia. */
  @IsOptional()
  @IsString()
  fecha?: string;
}
