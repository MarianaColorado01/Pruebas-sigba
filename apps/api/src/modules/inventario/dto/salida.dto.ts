import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, ValidateNested } from 'class-validator';

/**
 * Lo que entra por HTTP a la salida (ADR-04). Aquí se comprueban la forma y
 * los tipos; UUID, cantidades y tipo de despachador los valida
 * `SalidasService`, que es lo que tiene pruebas y arma la carga del hash.
 */

/** Una entrega trae decenas de filas, no cientos; el tope evita cargas absurdas. */
const MAXIMO_DE_FILAS = 200;

export class FilaDeSalidaDto {
  @IsString()
  movimientoId!: string;

  @IsString()
  referenciaId!: string;

  @IsString()
  loteId!: string;

  /** Texto con punto decimal; un número también vale. */
  @Transform(({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value))
  @IsString()
  cantidad!: string;
}

export class RegistrarSalidaDto {
  @IsString()
  comandoId!: string;

  @IsString()
  institucionId!: string;

  @IsString()
  bodegaId!: string;

  @IsString()
  despachador!: string;

  @IsString()
  despachadorTipo!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAXIMO_DE_FILAS)
  @ValidateNested({ each: true })
  @Type(() => FilaDeSalidaDto)
  detalles!: FilaDeSalidaDto[];
}
