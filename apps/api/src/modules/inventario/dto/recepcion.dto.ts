import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Lo que entra por HTTP a la recepción (ADR-04). Aquí se comprueban la forma y
 * los tipos; UUID, cantidades, fechas, origen y novedad los valida
 * `RecepcionesService`, que es lo que tiene pruebas y arma la carga del hash.
 */

/** Una donación grande trae decenas de filas, no cientos; el tope evita cargas absurdas. */
const MAXIMO_DE_FILAS = 200;

export class FilaDeRecepcionDto {
  @IsString()
  movimientoId!: string;

  @IsString()
  referenciaId!: string;

  /** Texto con punto decimal; un número también vale. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value))
  @IsString()
  cantidad!: string;

  @IsOptional()
  @IsString()
  lote?: string | null;

  /** AAAA-MM-DD, o nulo si el producto no trae fecha. */
  @IsOptional()
  @IsString()
  vencimiento?: string | null;

  @IsOptional()
  @IsString()
  novedad?: string | null;
}

export class RegistrarRecepcionDto {
  @IsString()
  comandoId!: string;

  @IsString()
  donanteId!: string;

  @IsString()
  origen!: string;

  @IsString()
  bodegaId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAXIMO_DE_FILAS)
  @ValidateNested({ each: true })
  @Type(() => FilaDeRecepcionDto)
  detalles!: FilaDeRecepcionDto[];
}
