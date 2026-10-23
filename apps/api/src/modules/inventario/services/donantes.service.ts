import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AltaDeDonante,
  type CambiosEnDonante,
  type Donante,
  DonantesRepositorio,
  NombreDeDonanteRepetido,
  TIPOS_DE_DONANTE,
  type TipoDonante,
} from './donante.js';

/** Suficiente para el buscador incremental de la recepción. */
const LIMITE_DE_BUSQUEDA = 20;

/** El largo de las columnas nombre y contacto. */
const LARGO_MAXIMO_DE_COLUMNA = 200;

export interface NuevoDonante {
  nombre: string;
  tipo: TipoDonante;
  contacto?: string | null;
}

export interface FiltroDeDonantes {
  texto?: string;
  tipo?: TipoDonante;
  incluirInactivos?: boolean;
}

export type EdicionDeDonante = Partial<NuevoDonante>;

/**
 * Directorio de donantes (SBA-25, RF-M1-18).
 *
 * El alta pide solo nombre y tipo para que la recepción no cambie de pantalla;
 * el contacto se completa después desde administración. Un donante no se
 * borra: se desactiva, porque las recepciones pasadas lo siguen nombrando.
 */
@Injectable()
export class DonantesService {
  constructor(private readonly repositorio: DonantesRepositorio) {}

  async crear(nuevo: NuevoDonante): Promise<Donante> {
    return (await this.darDeAlta(nuevo)).donante;
  }

  /**
   * El alta va en línea y sin `comandoId`: la llave natural es nombre y tipo.
   * Un doble toque o un reenvío devuelve el donante activo que ya existe en
   * vez de duplicarlo. Esa búsqueda es del repositorio, en la misma
   * transacción del alta.
   */
  async darDeAlta(nuevo: NuevoDonante): Promise<AltaDeDonante> {
    return this.repositorio.crear({
      nombre: nombreValido(nuevo.nombre),
      tipo: tipoValido(nuevo.tipo),
      contacto: contactoLimpio(nuevo.contacto),
    });
  }

  async buscar(filtro: FiltroDeDonantes = {}): Promise<Donante[]> {
    const texto = filtro.texto?.trim();

    return this.repositorio.buscar({
      ...(texto && { texto }),
      ...(filtro.tipo && { tipo: tipoValido(filtro.tipo) }),
      soloActivos: !filtro.incluirInactivos,
      limite: LIMITE_DE_BUSQUEDA,
    });
  }

  /** Lo que pide la recepción: que el donante exista en el banco y esté activo. */
  async obtenerActivo(id: string): Promise<Donante> {
    const [donante] = await this.repositorio.buscar({ id, soloActivos: true, limite: 1 });
    if (!donante) throw new NotFoundException('No existe ese donante o está desactivado.');
    return donante;
  }

  async editar(id: string, edicion: EdicionDeDonante): Promise<Donante> {
    const cambios: CambiosEnDonante = {};
    if (edicion.nombre !== undefined) cambios.nombre = nombreValido(edicion.nombre);
    if (edicion.tipo !== undefined) cambios.tipo = tipoValido(edicion.tipo);
    if (edicion.contacto !== undefined) cambios.contacto = contactoLimpio(edicion.contacto);

    return this.actualizar(id, cambios);
  }

  async desactivar(id: string): Promise<Donante> {
    return this.actualizar(id, { activo: false });
  }

  private async actualizar(id: string, cambios: CambiosEnDonante): Promise<Donante> {
    const donante = await this.repositorio.actualizar(id, cambios).catch((error: unknown) => {
      if (error instanceof NombreDeDonanteRepetido) {
        throw new ConflictException('Ya existe un donante activo con ese nombre y tipo.');
      }
      throw error;
    });
    // RLS no distingue «no existe» de «es de otro banco», y está bien: la
    // respuesta tampoco debe distinguirlos.
    if (!donante) throw new NotFoundException('No existe ese donante.');
    return donante;
  }
}

function nombreValido(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  if (!limpio) throw new BadRequestException('El donante necesita un nombre.');
  if (limpio.length > LARGO_MAXIMO_DE_COLUMNA) {
    throw new BadRequestException(
      `El nombre del donante no puede pasar de ${LARGO_MAXIMO_DE_COLUMNA} caracteres.`,
    );
  }
  return limpio;
}

function tipoValido(tipo: string): TipoDonante {
  if (!(TIPOS_DE_DONANTE as readonly string[]).includes(tipo)) {
    throw new BadRequestException(
      `Tipo de donante desconocido. Debe ser uno de: ${TIPOS_DE_DONANTE.join(', ')}.`,
    );
  }
  return tipo as TipoDonante;
}

function contactoLimpio(contacto: string | null | undefined): string | null {
  const limpio = contacto?.trim() || null;
  if (limpio && limpio.length > LARGO_MAXIMO_DE_COLUMNA) {
    throw new BadRequestException(
      `El contacto del donante no puede pasar de ${LARGO_MAXIMO_DE_COLUMNA} caracteres.`,
    );
  }
  return limpio;
}
