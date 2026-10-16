import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Autenticado, type IdentidadDeAutenticacion, Roles } from '../../../core/index.js';
import {
  AceptarInvitacionDto,
  InvitarAdministradorDto,
  InvitarAlBancoDto,
} from '../dto/invitacion.dto.js';
import { type InvitacionEmitida, UsuariosService } from '../services/usuarios.service.js';

type RespuestaHttp = { status(codigo: number): unknown };

/** Una invitación que ya existía responde 200 y no 201: no se creó nada. */
function conEstado(respuesta: RespuestaHttp, emitida: InvitacionEmitida): InvitacionEmitida {
  if (emitida.yaExistia) respuesta.status(200);
  return emitida;
}

/**
 * Invitaciones a un banco (SBA-19, D1 a D8). Quién invita a quién lo deciden
 * los `@Roles()` de cada ruta; aceptar solo pide sesión, porque la persona
 * todavía no tiene banco.
 */
@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class InvitacionesController {
  constructor(private readonly usuarios: UsuariosService) {}

  /**
   * El primer `admin_banco` de un banco lo invita `super_admin` (D7, D8). 201 si
   * crea la invitación; 200 si ya había una pendiente igual (idempotente).
   */
  @Roles('super_admin')
  @Post('bancos/:bancoId/invitaciones')
  async invitarAdministrador(
    @Param('bancoId', ParseUUIDPipe) bancoId: string,
    @Body() { email, nombre }: InvitarAdministradorDto,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ) {
    return conEstado(
      respuesta,
      await this.usuarios.invitar({ email, nombre, rol: 'admin_banco', bancoId }),
    );
  }

  /** 201 si crea la invitación; 200 si ya había una pendiente igual (idempotente). */
  @Roles('admin_banco')
  @Post('invitaciones')
  async invitar(
    @Body() invitacion: InvitarAlBancoDto,
    @Res({ passthrough: true }) respuesta: RespuestaHttp,
  ) {
    return conEstado(respuesta, await this.usuarios.invitarAlBanco(invitacion));
  }

  @Roles('admin_banco')
  @Get('invitaciones')
  listar() {
    return this.usuarios.invitacionesDelBanco();
  }

  @Autenticado()
  @Post('invitaciones/aceptar')
  @HttpCode(200)
  aceptar(
    @Body() { token }: AceptarInvitacionDto,
    @Req() peticion: { identidad?: IdentidadDeAutenticacion },
  ) {
    if (!peticion.identidad) throw new UnauthorizedException();
    return this.usuarios.aceptar(token, peticion.identidad);
  }

  @Roles('admin_banco')
  @Post('invitaciones/:id/reenviar')
  @HttpCode(200)
  reenviar(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.reenviar(id);
  }

  @Roles('admin_banco')
  @Post('invitaciones/:id/revocar')
  @HttpCode(200)
  revocar(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.revocar(id);
  }
}
