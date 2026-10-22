import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../../core/index.js';
import { DirectorioDeInstitucionesService } from '../services/directorio-de-instituciones.service.js';
import type { TipoDePoblacion } from '../services/institucion.js';

/**
 * Tipos de población del banco, para elegir el de una institución (SBA-86).
 * Solo lectura: el catálogo lo siembra el banco y no se administra aquí todavía.
 */
@Controller('tipos-de-poblacion')
@Roles('admin_banco', 'coordinacion')
export class TiposDePoblacionController {
  constructor(private readonly directorio: DirectorioDeInstitucionesService) {}

  @Get()
  listar(): Promise<TipoDePoblacion[]> {
    return this.directorio.tiposDePoblacion();
  }
}
