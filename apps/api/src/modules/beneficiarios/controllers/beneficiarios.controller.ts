import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type {
  BeneficiarioRegistrado,
  CodigoDeRegistroRechazado,
  FichaDeBeneficiario,
  HistorialDeMembresias,
  MembresiaDto,
} from '@sigba/shared-types';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import {
  BusquedaPorDocumentoDto,
  CerrarMembresiaDto,
  RegistrarBeneficiarioDto,
  TrasladarBeneficiarioDto,
} from '../dto/registro.dto.js';
import { MembresiasService } from '../services/membresias.service.js';
import { RegistroDeBeneficiariosService } from '../services/registro-de-beneficiarios.service.js';
import { type Membresia, RegistroSimultaneo } from '../services/registro.js';

const RECHAZOS: Record<CodigoDeRegistroRechazado, string> = {
  duplicidad:
    'La persona ya tiene membresía activa en otra institución. Coordinación revisa la alerta.',
  tipo_distinto:
    'Ese número ya está registrado con otro tipo de documento. Lo revisa coordinación.',
  registro_simultaneo: 'Otra alta de esta persona terminó primero. Intenta de nuevo.',
};

function aMembresiaDto(membresia: Membresia): MembresiaDto {
  return {
    ...membresia,
    inicioEn: membresia.inicioEn.toISOString(),
    finEn: membresia.finEn?.toISOString() ?? null,
  };
}

function rechazo(codigo: CodigoDeRegistroRechazado): ConflictException {
  return new ConflictException({ codigo, message: RECHAZOS[codigo] });
}

/**
 * Registro nominal (SBA-27, SBA-28). Registran coordinación y la
 * administración del banco, sin institución en el contexto (esquema v5.0,
 * sección 6). El rol institución no escribe hasta el portal (SBA-44).
 */
@Controller('beneficiarios')
@Roles('coordinacion', 'admin_banco')
export class BeneficiariosController {
  constructor(
    private readonly registro: RegistroDeBeneficiariosService,
    private readonly membresias: MembresiasService,
  ) {}

  /** 201 `creada`; 200 `ya_activa`; 409 con `codigo` (`RegistroRechazado`). */
  @Post()
  async registrar(
    @Body() alta: RegistrarBeneficiarioDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<BeneficiarioRegistrado> {
    let resultado;
    try {
      resultado = await this.registro.registrar(alta);
    } catch (error) {
      if (error instanceof RegistroSimultaneo) throw rechazo('registro_simultaneo');
      throw error;
    }
    // Después del commit: la alerta de una duplicidad ya quedó guardada.
    if (resultado.resultado === 'duplicidad' || resultado.resultado === 'tipo_distinto') {
      throw rechazo(resultado.resultado);
    }
    if (resultado.resultado === 'ya_activa') respuesta.status(200);
    return { ...resultado, membresia: aMembresiaDto(resultado.membresia) };
  }

  @Post('busqueda')
  @HttpCode(200)
  async buscar(@Body() { numeroDocumento }: BusquedaPorDocumentoDto): Promise<FichaDeBeneficiario> {
    const { persona, beneficiario } = await this.registro.buscarPorDocumento(numeroDocumento);
    return {
      persona,
      beneficiario: beneficiario && {
        ...beneficiario,
        membresiaActiva:
          beneficiario.membresiaActiva && aMembresiaDto(beneficiario.membresiaActiva),
      },
    };
  }

  /** Historial de membresías, de la más reciente a la más antigua (SBA-28). */
  @Get(':personaId/membresias')
  async historial(
    @Param('personaId', ParseUUIDPipe) personaId: string,
  ): Promise<HistorialDeMembresias> {
    return (await this.membresias.historial(personaId)).map(aMembresiaDto);
  }

  /** Solo coordinación (SBA-28). Responde la membresía nueva. */
  @Post(':personaId/traslado')
  @Roles('coordinacion')
  async trasladar(
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() { institucionId }: TrasladarBeneficiarioDto,
  ): Promise<MembresiaDto> {
    try {
      return aMembresiaDto(await this.membresias.trasladar(personaId, institucionId));
    } catch (error) {
      if (error instanceof RegistroSimultaneo) throw rechazo('registro_simultaneo');
      throw error;
    }
  }
}

/**
 * Cierre de una membresía con motivo tipificado, sin texto libre (SBA-28,
 * esquema v5.0 sección 7.8).
 */
@Controller('membresias')
@Roles('coordinacion', 'admin_banco')
export class MembresiasController {
  constructor(private readonly membresias: MembresiasService) {}

  @Post(':id/cerrar')
  @HttpCode(200)
  async cerrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { motivo }: CerrarMembresiaDto,
  ): Promise<MembresiaDto> {
    return aMembresiaDto(await this.membresias.cerrar(id, motivo));
  }
}
