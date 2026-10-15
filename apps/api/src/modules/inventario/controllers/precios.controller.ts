import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import { AprobarPrecioDto, PrecioVigenteDto, ProponerPrecioDto } from '../dto/precio.dto.js';
import type { Fuente, Precio } from '../services/precio.js';
import { type PrecioParaValorar, PreciosService } from '../services/precios.service.js';

const ROLES_DE_LECTURA = ['operario_bodega', 'voluntario', 'coordinacion', 'admin_banco'] as const;
const ROLES_DE_ESCRITURA = ['coordinacion', 'admin_banco'] as const;

/**
 * Maestro de precios (SBA-39). Proponen y aprueban la coordinación y la
 * administración del banco; consultan también bodega y voluntariado. Las
 * reglas viven en `PreciosService`.
 */
@Controller()
export class PreciosController {
  constructor(private readonly precios: PreciosService) {}

  /** 201 la primera vez; 200 con el mismo precio si el cliente reenvía el comando. */
  @Roles(...ROLES_DE_ESCRITURA)
  @Post('precios')
  async proponer(
    @Body() propuesta: ProponerPrecioDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Precio> {
    // El servicio valida la fuente contra su lista; aquí solo llega como texto.
    const { precio, repetida } = await this.precios.proponer({
      ...propuesta,
      fuente: propuesta.fuente as Fuente,
    });
    if (repetida) respuesta.status(200);
    return precio;
  }

  /** 201 la primera vez; 200 con el mismo precio si el cliente reenvía el comando. */
  @Roles(...ROLES_DE_ESCRITURA)
  @Post('precios/:id/aprobar')
  async aprobar(
    @Param('id', new ParseUUIDPipe()) precioId: string,
    @Body() aprobacion: AprobarPrecioDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<Precio> {
    const { precio, repetida } = await this.precios.aprobar({ ...aprobacion, precioId });
    if (repetida) respuesta.status(200);
    return precio;
  }

  /** Todos, con el estado del día: propuesto, aprobado o vencido. */
  @Roles(...ROLES_DE_LECTURA)
  @Get('referencias/:id/precios')
  historial(@Param('id', new ParseUUIDPipe()) referenciaId: string): Promise<Precio[]> {
    return this.precios.historial(referenciaId);
  }

  /**
   * 200 también sin precio: si no hay un aprobado vigente en la fecha, el
   * cuerpo trae `valoracion: 'pendiente'` y `precio: null`. No es un error,
   * es el estado con que se valora después (ADR-13). Una referencia que el
   * banco no tiene responde igual, así no se sabe si existe en otro banco.
   */
  @Roles(...ROLES_DE_LECTURA)
  @Get('referencias/:id/precio-vigente')
  vigente(
    @Param('id', new ParseUUIDPipe()) referenciaId: string,
    @Query() { fecha }: PrecioVigenteDto,
  ): Promise<PrecioParaValorar> {
    return this.precios.vigente(referenciaId, fecha);
  }
}
