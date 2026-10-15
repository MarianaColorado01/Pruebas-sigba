import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Lo que entra por HTTP a bancos y bodegas (ADR-04). Aquí se comprueban los
 * tipos; largos, espacios y forma del código los valida el servicio, que es lo
 * que tiene pruebas.
 */

/** En la edición, un campo obligatorio puede faltar pero no llegar nulo. */
const siLlega = ValidateIf((_, valor) => valor !== undefined);

export class CrearBancoDto {
  @IsString()
  nombre!: string;

  @IsString()
  codigo!: string;
}

export class EditarBancoDto {
  @siLlega
  @IsString()
  nombre?: string;

  @siLlega
  @IsString()
  codigo?: string;
}

export class CrearBodegaDto {
  @IsString()
  nombre!: string;

  @IsOptional()
  @IsString()
  direccion?: string | null;
}

export class EditarBodegaDto {
  @siLlega
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  direccion?: string | null;
}

export class FiltroDeBodegasDto {
  /** Llega como texto en la query: solo `true` incluye las inactivas. */
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  incluirInactivas?: boolean;
}
