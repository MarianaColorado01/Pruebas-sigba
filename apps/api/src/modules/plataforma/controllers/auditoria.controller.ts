import { Controller, Get, Header, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import type { PaginaDeAuditoria } from '@sigba/shared-types';
import { Roles } from '../../../core/index.js';
import { ConsultaDeAuditoriaDto, PeriodoDeAuditoriaDto } from '../dto/auditoria.dto.js';
import { ConsultaDeAuditoriaService } from '../services/consulta-de-auditoria.service.js';

/**
 * Quién hizo qué y cuándo en el banco (SBA-51, RF-M3-05). `super_admin` no
 * entra: no ve datos nominales de ningún banco (Arquitectura 8.6).
 */
@Controller('auditoria')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AuditoriaController {
  constructor(private readonly consulta: ConsultaDeAuditoriaService) {}

  @Get()
  @Roles('admin_banco', 'coordinacion')
  consultar(@Query() filtro: ConsultaDeAuditoriaDto): Promise<PaginaDeAuditoria> {
    return this.consulta.consultar(filtro);
  }

  @Get('exportar')
  @Roles('admin_banco')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="auditoria.csv"')
  exportar(@Query() { desde, hasta }: PeriodoDeAuditoriaDto): Promise<string> {
    return this.consulta.exportarCsv(desde, hasta);
  }
}
