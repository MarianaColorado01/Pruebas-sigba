import { IsDateString, IsDefined, Matches, ValidateIf } from 'class-validator';

export class ActualizarParametroDto {
  @IsDefined()
  valor!: unknown;

  @ValidateIf((_, fechaInicio) => fechaInicio !== undefined)
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fechaInicio?: string;
}
