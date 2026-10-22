import { Body, ConflictException, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type {
  BeneficiarioRegistrado,
  CodigoDeRegistroRechazado,
  FichaDeBeneficiario,
  MembresiaDto,
} from '@sigba/shared-types';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { BusquedaPorDocumentoDto, RegistrarBeneficiarioDto } from '../dto/registro.dto.js';
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
  constructor(private readonly registro: RegistroDeBeneficiariosService) {}

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
}
