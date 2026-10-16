import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AsignacionDeUsuario,
  type EstadoDeInvitacion,
  type MotivoDeInvitacionRechazada,
  ROLES,
  ROLES_INVITABLES_POR_ADMIN,
  type Rol,
} from '@sigba/shared-types';
import {
  EnviadorDeCorreo,
  getTenantContext,
  type IdentidadDeAutenticacion,
  type ResolutorDeIdentidad,
  type UsuarioResuelto,
} from '../../../core/index.js';
import {
  BancoInexistente,
  type CambioDeInvitacion,
  type DestinoDeInvitacion,
  type InvitacionCreada,
  InvitacionesRepositorio,
  PendienteConOtrosDatos,
} from './invitacion.js';
import { ORIGEN_DE_LA_PWA } from './origen-de-la-pwa.js';
import { UsuariosRepositorio } from './usuario.js';

const esRol = (codigo: string): codigo is Rol => (ROLES as readonly string[]).includes(codigo);

/** D4: el enlace vence a los 7 días. */
const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000;
const LARGO_NOMBRE = 200;
const LARGO_CORREO = 200;
/** Una arroba con algo a cada lado y un punto después. Lo demás lo dice el correo que rebote. */
const FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 32 bytes en base64url, sin relleno. */
const FORMA_DE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

const MENSAJES: Record<MotivoDeInvitacionRechazada, string> = {
  no_existe: 'Este enlace de invitación no existe.',
  vencida: 'Esta invitación venció. Pide a quien te invitó que la reenvíe.',
  usada: 'Este enlace ya se usó. Si no fuiste tú, avisa a quien te invitó.',
  revocada: 'Esta invitación se canceló.',
  correo_en_uso:
    'Ya hay otra cuenta de SIGBA con el correo de esta invitación. Inicia sesión con esa cuenta.',
  correo_no_verificado:
    'Para aceptar la invitación tu cuenta tiene que tener el correo verificado. Verifícalo y abre el enlace otra vez.',
  correo_no_coincide:
    'Esta invitación es para otro correo. Cierra sesión y entra con la cuenta del correo al que llegó.',
  usuario_inactivo: 'Tu cuenta de SIGBA está desactivada. Habla con quien administra la red.',
  banco_inactivo: 'Este banco está desactivado y no recibe personas nuevas.',
};

/** Rechazos por la cuenta de quien acepta o por el banco, no por el enlace. */
const RECHAZOS_CON_403: readonly MotivoDeInvitacionRechazada[] = [
  'correo_no_verificado',
  'correo_no_coincide',
  'usuario_inactivo',
  'banco_inactivo',
];

export interface Invitacion {
  email: string;
  nombre: string;
  rol: Rol;
  bancoId: string;
  institucionId?: string;
}

/**
 * El contrato de D9. `venceEn` sale como ISO 8601 en HTTP. Con `yaExistia` no
 * hay enlace ni correo: solo se guarda el hash del token, y reenviar da otro.
 */
export interface InvitacionEmitida {
  invitacionId: string;
  enlace: string | null;
  venceEn: Date;
  correoEnviado: boolean;
  yaExistia: boolean;
}

export interface InvitacionDelBanco {
  id: string;
  email: string;
  nombre: string;
  rol: Rol;
  estado: EstadoDeInvitacion;
  venceEn: Date;
  creadoEn: Date;
  aceptadaEn: Date | null;
  aceptadaPorNombre: string | null;
}

export interface UsuarioDelBanco {
  usuarioId: string;
  nombre: string;
  email: string;
  rol: Rol;
  institucionId: string | null;
  desde: Date;
}

/**
 * Usuarios, asignaciones e invitaciones de plataforma (SBA-8, SBA-19).
 *
 * Quién puede invitar a quién (D8) lo fijan las rutas con `@Roles()`. Aquí se
 * valida lo que vale para cualquier llamador, incluido M2 cuando invite a una
 * institución (D9).
 */
@Injectable()
export class UsuariosService implements ResolutorDeIdentidad {
  constructor(
    private readonly repositorio: UsuariosRepositorio,
    private readonly invitaciones: InvitacionesRepositorio,
    private readonly correo: EnviadorDeCorreo,
    @Inject(ORIGEN_DE_LA_PWA) private readonly origenDeLaPwa: string,
  ) {}

  async resolverIdentidad(
    identidad: IdentidadDeAutenticacion,
  ): Promise<UsuarioResuelto | undefined> {
    const usuarioId = await this.repositorio.idPorIdentidad(identidad);

    return usuarioId ? { usuarioId } : undefined;
  }

  /**
   * Bancos y roles con que la persona de la sesión puede trabajar (D13). Quien
   * se registró en Auth0 sin invitación no existe en SIGBA y recibe una lista
   * vacía, no un error: la PWA le pide que consiga una invitación.
   *
   * La red va primero; después cada banco por nombre y, dentro del banco, el
   * rol con más precedencia, que es el que la API usa en ese banco.
   */
  async asignacionesPropias(): Promise<AsignacionDeUsuario[]> {
    const usuarioId = getTenantContext()?.usuarioId;
    if (!usuarioId) return [];

    const filas = await this.repositorio.asignacionesActivas(usuarioId);

    return filas
      .flatMap(({ rol, ...resto }) => (esRol(rol) ? [{ rol, ...resto }] : []))
      .sort(
        (a, b) =>
          (a.bancoNombre ?? '').localeCompare(b.bancoNombre ?? '', 'es') ||
          ROLES.indexOf(a.rol) - ROLES.indexOf(b.rol),
      );
  }

  /**
   * Invita a una persona a un banco con un rol (D9). Devuelve el enlace, que
   * es el canal principal, y si además salió por correo (D1).
   *
   * Quien llama con un banco en el contexto solo invita a ese banco;
   * `super_admin`, que no tiene banco, invita al de la ruta (D7).
   *
   * Hay una pendiente por banco y correo. Invitar otra vez con el mismo rol e
   * institución devuelve la que existe, sin correo ni enlace; con otros datos
   * da 409.
   */
  async invitar(entrada: Invitacion): Promise<InvitacionEmitida> {
    const contextoBanco = getTenantContext()?.bancoId;
    if (contextoBanco && contextoBanco !== entrada.bancoId) {
      throw new ForbiddenException('Solo puedes invitar a tu banco.');
    }

    const email = correoValido(entrada.email);
    const nombre = nombreValido(entrada.nombre);
    const institucionId = institucionSegunRol(entrada.rol, entrada.institucionId);
    const { enlace, tokenHash, venceEn } = this.nuevoToken();

    let creada: InvitacionCreada;
    try {
      creada = await this.invitaciones.crear({
        bancoId: entrada.bancoId,
        email,
        nombre,
        rol: entrada.rol,
        institucionId,
        tokenHash,
        venceEn,
      });
    } catch (error) {
      if (error instanceof BancoInexistente) throw new NotFoundException('No existe ese banco.');
      if (error instanceof PendienteConOtrosDatos) {
        throw new ConflictException(
          'Ya hay una invitación pendiente para ese correo con otro rol. Revócala antes de invitar con el nuevo.',
        );
      }
      throw error;
    }

    if (creada.yaExistia) {
      return {
        invitacionId: creada.id,
        enlace: null,
        venceEn: creada.venceEn,
        correoEnviado: false,
        yaExistia: true,
      };
    }
    return this.emitir(creada.id, enlace, venceEn, {
      email,
      nombre,
      bancoNombre: creada.bancoNombre,
    });
  }

  /** Lo que usa `admin_banco` (D8): su banco y un rol interno. */
  async invitarAlBanco(entrada: Omit<Invitacion, 'bancoId' | 'institucionId'>) {
    if (!(ROLES_INVITABLES_POR_ADMIN as readonly string[]).includes(entrada.rol)) {
      throw new BadRequestException(
        `Desde aquí se invita como: ${ROLES_INVITABLES_POR_ADMIN.join(', ')}.`,
      );
    }
    return this.invitar({ ...entrada, bancoId: bancoDelContexto() });
  }

  /** Pendientes, vencidas y aceptadas del banco; las revocadas no. */
  async invitacionesDelBanco(): Promise<InvitacionDelBanco[]> {
    const ahora = Date.now();
    const filas = await this.invitaciones.listar();

    return filas.flatMap(({ rol, ...fila }) =>
      esRol(rol)
        ? [
            {
              ...fila,
              rol,
              estado: fila.aceptadaEn
                ? ('aceptada' as const)
                : fila.venceEn.getTime() <= ahora
                  ? ('vencida' as const)
                  : ('pendiente' as const),
            },
          ]
        : [],
    );
  }

  /** Token nuevo en la misma invitación; el enlace anterior deja de servir (D4). */
  async reenviar(id: string): Promise<InvitacionEmitida> {
    const { enlace, tokenHash, venceEn } = this.nuevoToken();
    const destino = pendiente(await this.invitaciones.renovarToken(id, tokenHash, venceEn));
    return this.emitir(id, enlace, venceEn, destino);
  }

  async revocar(id: string): Promise<{ invitacionId: string }> {
    pendiente(await this.invitaciones.revocar(id));
    return { invitacionId: id };
  }

  /**
   * Enlaza la cuenta de Auth0 con la invitación (D2, D3). Un enlace que no
   * sirve responde 410 con el motivo, para que la PWA diga qué pasó (D5).
   *
   * Exige un correo verificado en el token, y que sea el invitado: esa
   * comparación la hace `plataforma.aceptar_invitacion`, que es quien ve el
   * correo de la invitación. El 403 no dice a qué correo se invitó.
   */
  async aceptar(
    token: string,
    identidad: IdentidadDeAutenticacion,
  ): Promise<{ bancoId: string; rol: Rol }> {
    if (!identidad.emailVerificado || !identidad.email) {
      throw rechazo('correo_no_verificado');
    }

    const aceptacion = FORMA_DE_TOKEN.test(token)
      ? await this.invitaciones.aceptar(hashDe(token), identidad)
      : ({ resultado: 'no_existe' } as const);

    if (aceptacion.resultado === 'aceptada' && esRol(aceptacion.rol)) {
      return { bancoId: aceptacion.bancoId, rol: aceptacion.rol };
    }
    if (aceptacion.resultado === 'aceptada') {
      throw new Error('La invitación aceptada trae un rol fuera del contrato.');
    }

    throw rechazo(aceptacion.resultado);
  }

  async usuariosDelBanco(): Promise<UsuarioDelBanco[]> {
    const filas = await this.repositorio.delBanco();
    return filas.flatMap(({ rol, ...fila }) => (esRol(rol) ? [{ ...fila, rol }] : []));
  }

  /** Quita el acceso de la persona al banco del contexto (D15). Auth0 no se toca. */
  async desactivarAsignacion(
    usuarioId: string,
  ): Promise<{ usuarioId: string; desactivadas: number }> {
    if (usuarioId === getTenantContext()?.usuarioId) {
      throw new BadRequestException('No puedes quitarte el acceso a ti mismo.');
    }
    const desactivadas = await this.repositorio.desactivarAsignaciones(usuarioId);
    if (desactivadas === 0) {
      throw new NotFoundException('Esa persona no tiene acceso activo a este banco.');
    }
    return { usuarioId, desactivadas };
  }

  /** Arma el enlace y lo manda por correo si hay servidor. Corre después de confirmar. */
  private async emitir(
    invitacionId: string,
    enlace: string,
    venceEn: Date,
    { email, nombre, bancoNombre }: DestinoDeInvitacion,
  ): Promise<InvitacionEmitida> {
    const correoEnviado = await this.correo.enviar({
      para: email,
      asunto: `Invitación a SIGBA: ${bancoNombre}`,
      texto:
        `Hola, ${nombre}.\n\n` +
        `Te invitaron a trabajar en SIGBA con ${bancoNombre}. Abre este enlace para crear ` +
        `tu cuenta o entrar con la que ya tienes:\n\n${enlace}\n\n` +
        `El enlace sirve una sola vez y vence el ${venceEn.toISOString().slice(0, 10)}.`,
    });
    return { invitacionId, enlace, venceEn, correoEnviado, yaExistia: false };
  }

  private nuevoToken(): { enlace: string; tokenHash: string; venceEn: Date } {
    const token = randomBytes(32).toString('base64url');
    return {
      enlace: `${this.origenDeLaPwa}/invitacion/${token}`,
      tokenHash: hashDe(token),
      venceEn: new Date(Date.now() + VIGENCIA_MS),
    };
  }
}

/** 403 si el problema es la cuenta o el banco, 409 si el correo ya es de otra cuenta, 410 si el enlace. */
function rechazo(motivo: MotivoDeInvitacionRechazada): HttpException {
  const cuerpo = { codigo: motivo, message: MENSAJES[motivo] };
  if (RECHAZOS_CON_403.includes(motivo)) {
    return new ForbiddenException({ ...cuerpo, statusCode: 403 });
  }
  if (motivo === 'correo_en_uso') return new ConflictException({ ...cuerpo, statusCode: 409 });
  return new GoneException({ ...cuerpo, statusCode: 410 });
}

function hashDe(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function bancoDelContexto(): string {
  const bancoId = getTenantContext()?.bancoId;
  if (!bancoId) throw new Error('Invitación sin banco en el contexto de tenant.');
  return bancoId;
}

function pendiente(cambio: CambioDeInvitacion): DestinoDeInvitacion {
  if (cambio === 'no_existe') throw new NotFoundException('No existe esa invitación.');
  if (cambio === 'cerrada') {
    throw new ConflictException('Esa invitación ya se aceptó o se revocó.');
  }
  return cambio;
}

function correoValido(correo: string): string {
  const limpio = correo.trim().toLowerCase();
  if (!FORMA_DE_CORREO.test(limpio) || limpio.length > LARGO_CORREO) {
    throw new BadRequestException('El correo no tiene una forma válida.');
  }
  return limpio;
}

function nombreValido(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio) throw new BadRequestException('La invitación necesita el nombre de la persona.');
  if (limpio.length > LARGO_NOMBRE) {
    throw new BadRequestException(`El nombre no puede pasar de ${LARGO_NOMBRE} caracteres.`);
  }
  return limpio;
}

/** `super_admin` no se invita (D8); `institucion` va con su institución y nadie más. */
function institucionSegunRol(rol: Rol, institucionId: string | undefined): string | null {
  if (!esRol(rol) || rol === 'super_admin') {
    throw new BadRequestException('Ese rol no se puede invitar.');
  }
  if (rol === 'institucion') {
    if (!institucionId)
      throw new BadRequestException('El rol institución necesita su institución.');
    return institucionId;
  }
  if (institucionId) {
    throw new BadRequestException('Solo el rol institución va con institución.');
  }
  return null;
}
