import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CambiosEnInstitucion,
  DIAS_DE_RECOGIDA,
  type DiaDeRecogida,
  type Institucion,
  InstitucionesRepositorio,
  NombreDeInstitucionRepetido,
  TIPOS_DE_INSTITUCION,
  type TipoDeInstitucion,
  type TipoDePoblacion,
  TipoDePoblacionInexistente,
} from './institucion.js';

/** El largo de las columnas de `institucion`. */
const LARGO_NOMBRE = 200;
const LARGO_TELEFONO = 30;
const LARGO_CORREO = 200;
const LARGO_DIRECCION = 500;

/** Una arroba con algo a cada lado y un punto después. Lo demás lo dice el correo que rebote. */
const FORMA_DE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface NuevaInstitucion {
  nombre: string;
  tipo: TipoDeInstitucion;
  contactoNombre: string;
  tipoPoblacionId: string;
  contactoTelefono?: string | null;
  contactoCorreo?: string | null;
  direccion?: string | null;
  diaRecogida?: DiaDeRecogida | null;
}

export type EdicionDeInstitucion = Partial<NuevaInstitucion>;

export interface FiltroDeInstituciones {
  texto?: string;
  tipo?: TipoDeInstitucion;
  incluirInactivas?: boolean;
}

/**
 * Directorio de instituciones (SBA-26, RF-M2-01).
 *
 * Es la parte de escritura y la que usa coordinación. Lo que M1 consulta para
 * elegir destinatario es `InstitucionesService`, de solo lectura (SBA-33). Una
 * institución no se borra: se desactiva, porque las salidas pasadas la siguen
 * nombrando.
 */
@Injectable()
export class DirectorioDeInstitucionesService {
  constructor(private readonly repositorio: InstitucionesRepositorio) {}

  async crear(nueva: NuevaInstitucion): Promise<Institucion> {
    return this.proteger(() =>
      this.repositorio.crear({
        nombre: nombreValido(nueva.nombre),
        tipo: tipoValido(nueva.tipo),
        contactoNombre: contactoNombreValido(nueva.contactoNombre),
        contactoTelefono: telefonoLimpio(nueva.contactoTelefono),
        contactoCorreo: correoLimpio(nueva.contactoCorreo),
        direccion: direccionLimpia(nueva.direccion),
        diaRecogida: diaValido(nueva.diaRecogida),
        tipoPoblacionId: tipoDePoblacionValido(nueva.tipoPoblacionId),
      }),
    );
  }

  async buscar(filtro: FiltroDeInstituciones = {}): Promise<Institucion[]> {
    const texto = filtro.texto?.trim();

    return this.repositorio.buscar({
      ...(texto && { texto }),
      ...(filtro.tipo && { tipo: tipoValido(filtro.tipo) }),
      soloActivas: !filtro.incluirInactivas,
    });
  }

  /**
   * Las opciones del formulario. Van también los inactivos: una institución
   * puede seguir con uno y la pantalla tiene que poder nombrarlo.
   */
  async tiposDePoblacion(): Promise<TipoDePoblacion[]> {
    return this.repositorio.tiposDePoblacion();
  }

  async editar(id: string, edicion: EdicionDeInstitucion): Promise<Institucion> {
    const cambios: CambiosEnInstitucion = {};
    if (edicion.nombre !== undefined) cambios.nombre = nombreValido(edicion.nombre);
    if (edicion.tipo !== undefined) cambios.tipo = tipoValido(edicion.tipo);
    if (edicion.contactoNombre !== undefined) {
      cambios.contactoNombre = contactoNombreValido(edicion.contactoNombre);
    }
    if (edicion.contactoTelefono !== undefined) {
      cambios.contactoTelefono = telefonoLimpio(edicion.contactoTelefono);
    }
    if (edicion.contactoCorreo !== undefined) {
      cambios.contactoCorreo = correoLimpio(edicion.contactoCorreo);
    }
    if (edicion.direccion !== undefined) cambios.direccion = direccionLimpia(edicion.direccion);
    if (edicion.diaRecogida !== undefined) cambios.diaRecogida = diaValido(edicion.diaRecogida);
    if (edicion.tipoPoblacionId !== undefined) {
      cambios.tipoPoblacionId = tipoDePoblacionValido(edicion.tipoPoblacionId);
    }

    return this.actualizar(id, cambios);
  }

  async desactivar(id: string): Promise<Institucion> {
    return this.actualizar(id, { activa: false });
  }

  private async actualizar(id: string, cambios: CambiosEnInstitucion): Promise<Institucion> {
    const institucion = await this.proteger(() => this.repositorio.actualizar(id, cambios));
    // RLS no distingue «no existe» de «es de otro banco», y está bien: la
    // respuesta tampoco debe distinguirlos.
    if (!institucion) throw new NotFoundException('No existe esa institución.');
    return institucion;
  }

  /** Traduce los errores del puerto a respuestas HTTP. */
  private async proteger<R>(operacion: () => Promise<R>): Promise<R> {
    try {
      return await operacion();
    } catch (error) {
      if (error instanceof NombreDeInstitucionRepetido) {
        throw new ConflictException('Ya existe una institución con ese nombre.');
      }
      if (error instanceof TipoDePoblacionInexistente) {
        throw new BadRequestException('El tipo de población no existe en este banco.');
      }
      throw error;
    }
  }
}

function nombreValido(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio) throw new BadRequestException('La institución necesita un nombre.');
  return conLargoMaximo(limpio, LARGO_NOMBRE, 'El nombre de la institución');
}

function contactoNombreValido(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio) throw new BadRequestException('La institución necesita una persona de contacto.');
  return conLargoMaximo(limpio, LARGO_NOMBRE, 'El nombre del contacto');
}

function tipoValido(tipo: string): TipoDeInstitucion {
  if (!(TIPOS_DE_INSTITUCION as readonly string[]).includes(tipo)) {
    throw new BadRequestException(
      `Tipo de institución desconocido. Debe ser uno de: ${TIPOS_DE_INSTITUCION.join(', ')}.`,
    );
  }
  return tipo as TipoDeInstitucion;
}

function diaValido(dia: string | null | undefined): DiaDeRecogida | null {
  if (dia === null || dia === undefined) return null;
  if (!(DIAS_DE_RECOGIDA as readonly string[]).includes(dia)) {
    throw new BadRequestException(
      `Día de recogida desconocido. Debe ser uno de: ${DIAS_DE_RECOGIDA.join(', ')}.`,
    );
  }
  return dia as DiaDeRecogida;
}

function tipoDePoblacionValido(id: string): string {
  const limpio = id.trim();
  if (!limpio) throw new BadRequestException('La institución necesita un tipo de población.');
  return limpio;
}

function telefonoLimpio(telefono: string | null | undefined): string | null {
  const limpio = telefono?.trim() || null;
  return limpio && conLargoMaximo(limpio, LARGO_TELEFONO, 'El teléfono');
}

function correoLimpio(correo: string | null | undefined): string | null {
  const limpio = correo?.trim().toLowerCase() || null;
  if (!limpio) return null;
  if (!FORMA_DE_CORREO.test(limpio)) {
    throw new BadRequestException('El correo de contacto no tiene una forma válida.');
  }
  return conLargoMaximo(limpio, LARGO_CORREO, 'El correo');
}

function direccionLimpia(direccion: string | null | undefined): string | null {
  const limpia = direccion?.trim() || null;
  return limpia && conLargoMaximo(limpia, LARGO_DIRECCION, 'La dirección');
}

function conLargoMaximo(valor: string, maximo: number, que: string): string {
  if (valor.length > maximo) {
    throw new BadRequestException(`${que} no puede pasar de ${maximo} caracteres.`);
  }
  return valor;
}
