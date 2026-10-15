import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../../core/index.js';
import {
  BuscarReferenciasDto,
  CrearCategoriaDto,
  CrearProductoDto,
  CrearReferenciaDto,
  EditarCategoriaDto,
  EditarProductoDto,
  EditarReferenciaDto,
} from '../dto/catalogo.dto.js';
import { ReferenciasService } from '../services/referencias.service.js';

const ROLES_DE_LECTURA = ['operario_bodega', 'voluntario', 'coordinacion', 'admin_banco'] as const;
const ROLES_DE_ESCRITURA = ['coordinacion', 'admin_banco'] as const;

/**
 * Catálogo por HTTP (SBA-22). Traduce HTTP a `ReferenciasService`; las reglas
 * viven en el servicio. Consultan bodega, voluntariado, coordinación y la
 * administración del banco; dar de alta, editar y desactivar es de coordinación
 * y administración. El alta desde el celular es de SBA-23.
 */
@Controller()
export class ReferenciasController {
  constructor(private readonly referencias: ReferenciasService) {}

  @Roles(...ROLES_DE_LECTURA)
  @Get('referencias')
  buscar(@Query() filtro: BuscarReferenciasDto) {
    return this.referencias.buscar(filtro);
  }

  @Roles(...ROLES_DE_LECTURA)
  @Get('catalogo')
  async catalogo(
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() respuesta: Response,
  ): Promise<void> {
    const catalogo = await this.referencias.catalogo();
    respuesta.setHeader('ETag', `"${catalogo.version}"`);
    if (etagsCoinciden(ifNoneMatch, catalogo.version)) {
      respuesta.status(304).end();
      return;
    }
    respuesta.status(200).json(catalogo);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('categorias')
  crearCategoria(@Body() datos: CrearCategoriaDto) {
    return this.referencias.crearCategoria(datos);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Patch('categorias/:id')
  editarCategoria(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() cambios: EditarCategoriaDto,
  ) {
    return this.referencias.editarCategoria(id, cambios);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('categorias/:id/desactivar')
  desactivarCategoria(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.referencias.desactivarCategoria(id);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('categorias/:id/reactivar')
  reactivarCategoria(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.referencias.reactivarCategoria(id);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('productos')
  crearProducto(@Body() datos: CrearProductoDto) {
    return this.referencias.crearProducto(datos);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Patch('productos/:id')
  editarProducto(@Param('id', new ParseUUIDPipe()) id: string, @Body() cambios: EditarProductoDto) {
    return this.referencias.editarProducto(id, cambios);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('productos/:id/desactivar')
  desactivarProducto(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.referencias.desactivarProducto(id);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('productos/:id/reactivar')
  reactivarProducto(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.referencias.reactivarProducto(id);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('referencias')
  crearReferencia(@Body() datos: CrearReferenciaDto) {
    return this.referencias.crearReferencia(datos);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Patch('referencias/:id')
  editarReferencia(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() cambios: EditarReferenciaDto,
  ) {
    return this.referencias.editarReferencia(id, cambios);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('referencias/:id/desactivar')
  desactivarReferencia(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.referencias.desactivarReferencia(id);
  }

  @Roles(...ROLES_DE_ESCRITURA)
  @Post('referencias/:id/reactivar')
  reactivarReferencia(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.referencias.reactivarReferencia(id);
  }
}

function etagsCoinciden(cabecera: string | undefined, version: string): boolean {
  return (
    cabecera
      ?.split(',')
      .map((etiqueta) => etiqueta.trim().replace(/^W\//, '').replace(/^"|"$/g, ''))
      .some((etiqueta) => etiqueta === '*' || etiqueta === version) ?? false
  );
}
