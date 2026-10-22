import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';
import { TIPOS_DE_DONANTE, type TipoDonante } from '../services/donante.js';

/**
 * Lo que entra por HTTP al directorio de donantes (ADR-04). Aquí se comprueban
 * los tipos; espacios y largos los valida `DonantesService`, que es lo que
 * tiene pruebas.
 */

/** En la edición, un campo obligatorio puede faltar pero no llegar nulo. */
const siLlega = ValidateIf((_, valor) => valor !== undefined);

/** La query llega como texto: «true» y «false» pasan a booleano. */
const booleanoDeQuery = Transform(({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value,
);

export class BuscarDonantesDto {
  @IsOptional()
  @IsString()
  texto?: string;

  @IsOptional()
  @IsIn(TIPOS_DE_DONANTE)
  tipo?: TipoDonante;

  @IsOptional()
  @booleanoDeQuery
  @IsBoolean()
  incluirInactivos?: boolean;
}

export class CrearDonanteDto {
  @IsString()
  nombre!: string;

  @IsIn(TIPOS_DE_DONANTE)
  tipo!: TipoDonante;

  @IsOptional()
  @IsString()
  contacto?: string | null;
}

export class EditarDonanteDto {
  @siLlega
  @IsString()
  nombre?: string;

  @siLlega
  @IsIn(TIPOS_DE_DONANTE)
  tipo?: TipoDonante;

  @IsOptional()
  @IsString()
  contacto?: string | null;
}
