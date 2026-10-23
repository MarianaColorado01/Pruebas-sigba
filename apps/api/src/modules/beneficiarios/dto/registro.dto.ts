import { Type } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import {
  MOTIVOS_DE_CIERRE_DE_MEMBRESIA,
  type MotivoDeCierreDeMembresia,
  PARENTESCOS,
  type Parentesco,
  SEXOS,
  type Sexo,
  TIPOS_DE_DOCUMENTO,
  type TipoDeDocumento,
} from '@sigba/shared-types';

/**
 * Lo que entra por HTTP al registro nominal (ADR-04). Aquí se comprueban los
 * tipos; documento, largos y fechas los valida el servicio, que tiene las
 * pruebas. Contrato en `@sigba/shared-types` (`RegistrarBeneficiario`).
 */

export class PersonaDto {
  @IsIn(TIPOS_DE_DOCUMENTO)
  tipoDocumento!: TipoDeDocumento;

  @IsString()
  numeroDocumento!: string;

  @IsString()
  nombres!: string;

  @IsString()
  apellidos!: string;

  @IsIn(SEXOS)
  sexo!: Sexo;

  @IsString()
  fechaNacimiento!: string;

  @IsOptional()
  @IsString()
  telefono?: string | null;

  @IsOptional()
  @IsString()
  direccion?: string | null;
}

export class RepresentanteDto {
  @ValidateNested()
  @Type(() => PersonaDto)
  persona!: PersonaDto;

  @IsIn(PARENTESCOS)
  parentesco!: Parentesco;
}

export class ConsentimientoDto {
  @Equals(true, { message: 'Sin consentimiento no se registra a la persona.' })
  otorgado!: true;

  @IsString()
  versionAviso!: string;

  @IsOptional()
  @IsString()
  otorganteNumeroDocumento?: string;
}

export class RegistrarBeneficiarioDto {
  @IsUUID()
  institucionId!: string;

  @IsUUID()
  tipoPoblacionId!: string;

  @ValidateNested()
  @Type(() => PersonaDto)
  persona!: PersonaDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RepresentanteDto)
  representantes?: RepresentanteDto[];

  @ValidateNested()
  @Type(() => ConsentimientoDto)
  consentimiento!: ConsentimientoDto;
}

export class BusquedaPorDocumentoDto {
  @IsString()
  numeroDocumento!: string;
}

export class CerrarMembresiaDto {
  @IsIn(MOTIVOS_DE_CIERRE_DE_MEMBRESIA)
  motivo!: MotivoDeCierreDeMembresia;
}

export class TrasladarBeneficiarioDto {
  @IsUUID()
  institucionId!: string;
}
