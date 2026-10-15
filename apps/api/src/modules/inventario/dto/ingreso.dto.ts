import { IsString } from 'class-validator';

/**
 * Lo que entra por HTTP a los ingresos del mes (ADR-04). El formato AAAA-MM
 * lo valida `IngresosService`, que es lo que tiene pruebas.
 */
export class IngresosDelMesDto {
  @IsString()
  mes!: string;
}
