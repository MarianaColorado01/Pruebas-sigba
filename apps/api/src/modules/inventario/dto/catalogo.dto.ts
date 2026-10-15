import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

/**
 * Lo que entra por HTTP al catálogo (ADR-04). Aquí se comprueban los tipos;
 * largos, espacios, el código del Banco y la equivalencia los valida
 * `ReferenciasService`, que es lo que tiene pruebas.
 */

/** En la edición, un campo obligatorio puede faltar pero no llegar nulo. */
const siLlega = ValidateIf((_, valor) => valor !== undefined);

/** La query llega como texto: «true» y «false» pasan a booleano. */
const booleanoDeQuery = Transform(({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value,
);

/** La equivalencia viaja como texto para no perder decimales; un número también vale. */
const comoTexto = Transform(({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value,
);

export class BuscarReferenciasDto {
  @IsOptional()
  @IsString()
  texto?: string;

  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsOptional()
  @booleanoDeQuery
  @IsBoolean()
  incluirInactivas?: boolean;
}

export class CrearCategoriaDto {
  @IsOptional()
  @IsString()
  codigo?: string | null;

  @IsString()
  nombre!: string;

  @IsOptional()
  @IsString()
  linea?: string | null;

  @IsOptional()
  @IsString()
  descripcion?: string | null;
}

export class EditarCategoriaDto {
  @IsOptional()
  @IsString()
  codigo?: string | null;

  @siLlega
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  linea?: string | null;

  @IsOptional()
  @IsString()
  descripcion?: string | null;
}

export class CrearProductoDto {
  @IsUUID()
  categoriaId!: string;

  @IsString()
  nombre!: string;
}

export class EditarProductoDto {
  @siLlega
  @IsUUID()
  categoriaId?: string;

  @siLlega
  @IsString()
  nombre?: string;
}

export class CrearReferenciaDto {
  @IsUUID()
  productoId!: string;

  @IsString()
  presentacion!: string;

  @comoTexto
  @IsString()
  equivalenciaKg!: string;
}

export class EditarReferenciaDto {
  @siLlega
  @IsUUID()
  productoId?: string;

  @siLlega
  @IsString()
  presentacion?: string;

  @siLlega
  @comoTexto
  @IsString()
  equivalenciaKg?: string;
}
