import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';

/**
 * Lo que entra por HTTP a bajas y ajustes (ADR-04). Aquí se comprueban la
 * forma y los tipos; UUID, cantidad y motivo los valida
 * `BajasYAjustesService`, que es lo que tiene pruebas y arma la carga del hash.
 */

/** Texto con punto decimal; un número también vale. */
const comoTexto = ({ value }: { value: unknown }) =>
  typeof value === 'number' ? String(value) : value;

/**
 * Baja y ajuste traen los mismos campos. En la baja, `cantidad` es lo que
 * sale, mayor que cero, y `motivo` uno de la lista; en el ajuste, `cantidad`
 * lleva signo y `motivo` es texto libre obligatorio.
 */
export class MovimientoSobreUnLoteDto {
  @IsString()
  comandoId!: string;

  @IsString()
  movimientoId!: string;

  @IsString()
  bodegaId!: string;

  @IsString()
  referenciaId!: string;

  @IsString()
  loteId!: string;

  @Transform(comoTexto)
  @IsString()
  cantidad!: string;

  @IsString()
  motivo!: string;
}
