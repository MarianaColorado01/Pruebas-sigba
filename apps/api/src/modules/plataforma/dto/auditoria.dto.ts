import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ACCIONES_DE_AUDITORIA,
  type AccionDeAuditoria,
  TIPOS_DE_ACTOR,
  type TipoDeActor,
} from '@sigba/shared-types';

/**
 * Filtros de `GET /auditoria` (ADR-04). Las fechas llegan en ISO 8601 con
 * zona: la PWA manda el inicio del día local, no la fecha suelta.
 */
export class ConsultaDeAuditoriaDto {
  /** UUID del usuario o etiqueta de la tarea, por ejemplo `sistema:retencion`. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actor?: string;

  @IsOptional()
  @IsIn(TIPOS_DE_ACTOR)
  tipoActor?: TipoDeActor;

  @IsOptional()
  @Matches(/^[a-z_][a-z0-9_]*$/)
  entidad?: string;

  @IsOptional()
  @IsIn(ACCIONES_DE_AUDITORIA)
  accion?: AccionDeAuditoria;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hasta?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite?: number;
}

/** Periodo `[desde, hasta)` de `GET /auditoria/exportar`. */
export class PeriodoDeAuditoriaDto {
  @Type(() => Date)
  @IsDate()
  desde!: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}
