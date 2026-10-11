import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';
import {
  DIAS_DE_RECOGIDA,
  type DiaDeRecogida,
  TIPOS_DE_INSTITUCION,
  type TipoDeInstitucion,
} from '../services/institucion.js';

/**
 * Lo que entra por HTTP al directorio de instituciones (ADR-04). Aquí se
 * comprueban los tipos; largos, espacios y forma del correo los valida el
 * servicio, que es lo que tiene pruebas.
 */

/** En la edición, un campo obligatorio puede faltar pero no llegar nulo. */
const siLlega = ValidateIf((_, valor) => valor !== undefined);

export class CrearInstitucionDto {
  @IsString()
  nombre!: string;

  @IsIn(TIPOS_DE_INSTITUCION)
  tipo!: TipoDeInstitucion;

  @IsString()
  contactoNombre!: string;

  @IsUUID()
  tipoPoblacionId!: string;

  @IsOptional()
  @IsString()
  contactoTelefono?: string | null;

  @IsOptional()
  @IsString()
  contactoCorreo?: string | null;

  @IsOptional()
  @IsString()
  direccion?: string | null;

  @IsOptional()
  @IsIn(DIAS_DE_RECOGIDA)
  diaRecogida?: DiaDeRecogida | null;
}

export class EditarInstitucionDto {
  @siLlega
  @IsString()
  nombre?: string;

  @siLlega
  @IsIn(TIPOS_DE_INSTITUCION)
  tipo?: TipoDeInstitucion;

  @siLlega
  @IsString()
  contactoNombre?: string;

  @siLlega
  @IsUUID()
  tipoPoblacionId?: string;

  @IsOptional()
  @IsString()
  contactoTelefono?: string | null;

  @IsOptional()
  @IsString()
  contactoCorreo?: string | null;

  @IsOptional()
  @IsString()
  direccion?: string | null;

  @IsOptional()
  @IsIn(DIAS_DE_RECOGIDA)
  diaRecogida?: DiaDeRecogida | null;
}

export class FiltroDeInstitucionesDto {
  @IsOptional()
  @IsString()
  texto?: string;

  @IsOptional()
  @IsIn(TIPOS_DE_INSTITUCION)
  tipo?: TipoDeInstitucion;

  /** Llega como texto en la query: solo `true` incluye las inactivas. */
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  incluirInactivas?: boolean;
}
