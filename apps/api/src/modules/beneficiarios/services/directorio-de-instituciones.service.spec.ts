import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { DirectorioDeInstitucionesService } from './directorio-de-instituciones.service.js';
import {
  type BusquedaDeInstituciones,
  type CambiosEnInstitucion,
  type DatosDeInstitucion,
  type Institucion,
  InstitucionesRepositorio,
  NombreDeInstitucionRepetido,
  type TipoDePoblacion,
  TipoDePoblacionInexistente,
} from './institucion.js';

const TIPO_POBLACION = '11111111-1111-1111-1111-111111111111';

/** Repositorio en memoria: guarda lo que recibe para que la prueba lo mire. */
class RepositorioEnMemoria extends InstitucionesRepositorio {
  instituciones: Institucion[] = [];
  ultimaBusqueda?: BusquedaDeInstituciones;
  tiposInexistentes = new Set<string>();
  tipos: TipoDePoblacion[] = [];

  async crear(datos: DatosDeInstitucion): Promise<Institucion> {
    this.validar(datos.nombre, datos.tipoPoblacionId);
    const institucion = {
      id: `i-${this.instituciones.length + 1}`,
      activa: true,
      actualizadoPor: null,
      actualizadoEn: null,
      ...datos,
    };
    this.instituciones.push(institucion);
    return institucion;
  }

  async buscar(busqueda: BusquedaDeInstituciones): Promise<Institucion[]> {
    this.ultimaBusqueda = busqueda;
    return this.instituciones.filter(
      (i) => (!busqueda.tipo || i.tipo === busqueda.tipo) && (!busqueda.soloActivas || i.activa),
    );
  }

  async tiposDePoblacion(): Promise<TipoDePoblacion[]> {
    return this.tipos;
  }

  async actualizar(id: string, cambios: CambiosEnInstitucion): Promise<Institucion | null> {
    const institucion = this.instituciones.find((i) => i.id === id);
    if (!institucion) return null;
    this.validar(cambios.nombre, cambios.tipoPoblacionId, id);
    Object.assign(institucion, cambios);
    return institucion;
  }

  private validar(nombre?: string, tipoPoblacionId?: string, propia?: string): void {
    if (
      nombre &&
      this.instituciones.some(
        (i) => i.id !== propia && i.nombre.toLowerCase() === nombre.toLowerCase(),
      )
    ) {
      throw new NombreDeInstitucionRepetido();
    }
    if (tipoPoblacionId && this.tiposInexistentes.has(tipoPoblacionId)) {
      throw new TipoDePoblacionInexistente();
    }
  }
}

const nueva = {
  nombre: 'Parroquia San José',
  tipo: 'parroquia',
  contactoNombre: 'María Gómez',
  tipoPoblacionId: TIPO_POBLACION,
} as const;

describe('DirectorioDeInstitucionesService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: DirectorioDeInstitucionesService;

  beforeEach(() => {
    repositorio = new RepositorioEnMemoria();
    servicio = new DirectorioDeInstitucionesService(repositorio);
  });

  describe('crear', () => {
    it('da de alta con lo mínimo y deja lo opcional en nulo', async () => {
      const institucion = await servicio.crear(nueva);

      expect(institucion).toMatchObject({
        nombre: 'Parroquia San José',
        tipo: 'parroquia',
        contactoNombre: 'María Gómez',
        contactoTelefono: null,
        contactoCorreo: null,
        direccion: null,
        diaRecogida: null,
        activa: true,
      });
    });

    it('limpia espacios, pasa el correo a minúsculas y guarda lo opcional que viene', async () => {
      const institucion = await servicio.crear({
        ...nueva,
        nombre: '  Fundación   Santa  Ana ',
        tipo: 'fundacion',
        contactoTelefono: ' 300 000 0000 ',
        contactoCorreo: ' Santa.Ana@Ejemplo.TEST ',
        direccion: ' Cra 7 # 10-20 ',
        diaRecogida: 'jueves',
      });

      expect(institucion).toMatchObject({
        nombre: 'Fundación Santa Ana',
        contactoTelefono: '300 000 0000',
        contactoCorreo: 'santa.ana@ejemplo.test',
        direccion: 'Cra 7 # 10-20',
        diaRecogida: 'jueves',
      });
    });

    it('rechaza un nombre vacío o de solo espacios', async () => {
      await expect(servicio.crear({ ...nueva, nombre: '   ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un nombre más largo que la columna', async () => {
      await expect(servicio.crear({ ...nueva, nombre: 'a'.repeat(201) })).rejects.toThrow(
        /no puede pasar de 200/,
      );
    });

    it('rechaza una persona de contacto vacía', async () => {
      await expect(servicio.crear({ ...nueva, contactoNombre: ' ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rechaza un tipo de institución desconocido', async () => {
      await expect(
        servicio.crear({ ...nueva, tipo: 'club' as unknown as 'parroquia' }),
      ).rejects.toThrow(/Tipo de institución desconocido/);
    });

    it('rechaza un día de recogida desconocido', async () => {
      await expect(
        servicio.crear({ ...nueva, diaRecogida: 'feriado' as unknown as 'lunes' }),
      ).rejects.toThrow(/Día de recogida desconocido/);
    });

    it('rechaza un correo sin forma de correo', async () => {
      await expect(servicio.crear({ ...nueva, contactoCorreo: 'sin-arroba' })).rejects.toThrow(
        /correo/,
      );
    });

    it('rechaza un teléfono más largo que la columna', async () => {
      await expect(servicio.crear({ ...nueva, contactoTelefono: '3'.repeat(31) })).rejects.toThrow(
        /no puede pasar de 30/,
      );
    });

    it('rechaza una institución sin tipo de población', async () => {
      await expect(servicio.crear({ ...nueva, tipoPoblacionId: ' ' })).rejects.toThrow(
        /tipo de población/,
      );
    });

    it('responde 409 si el nombre ya existe en el banco', async () => {
      await servicio.crear(nueva);

      await expect(servicio.crear({ ...nueva, nombre: 'PARROQUIA SAN JOSÉ' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('responde 400 si el tipo de población no existe en el banco', async () => {
      repositorio.tiposInexistentes.add(TIPO_POBLACION);

      await expect(servicio.crear(nueva)).rejects.toThrow(/tipo de población no existe/);
    });
  });

  describe('buscar', () => {
    it('por defecto solo pide las activas', async () => {
      await servicio.buscar();

      expect(repositorio.ultimaBusqueda).toEqual({ soloActivas: true });
    });

    it('con incluirInactivas pide todas', async () => {
      await servicio.buscar({ incluirInactivas: true });

      expect(repositorio.ultimaBusqueda).toMatchObject({ soloActivas: false });
    });

    it('pasa el texto sin espacios sobrantes y el tipo', async () => {
      await servicio.buscar({ texto: '  san  ', tipo: 'parroquia' });

      expect(repositorio.ultimaBusqueda).toEqual({
        texto: 'san',
        tipo: 'parroquia',
        soloActivas: true,
      });
    });

    it('ignora un texto de solo espacios', async () => {
      await servicio.buscar({ texto: '   ' });

      expect(repositorio.ultimaBusqueda).toEqual({ soloActivas: true });
    });

    it('rechaza un tipo desconocido en el filtro', async () => {
      await expect(servicio.buscar({ tipo: 'club' as unknown as 'parroquia' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('tiposDePoblacion', () => {
    it('devuelve también los inactivos, para nombrar el de una institución vieja', async () => {
      repositorio.tipos = [
        { id: 'p-1', nombre: 'Adultos mayores', activo: false },
        { id: 'p-2', nombre: 'Familias', activo: true },
      ];

      await expect(servicio.tiposDePoblacion()).resolves.toEqual(repositorio.tipos);
    });
  });

  describe('editar', () => {
    it('cambia solo lo que llega', async () => {
      const { id } = await servicio.crear(nueva);

      const editada = await servicio.editar(id, { contactoTelefono: '310 111 1111' });

      expect(editada).toMatchObject({
        nombre: 'Parroquia San José',
        contactoNombre: 'María Gómez',
        contactoTelefono: '310 111 1111',
      });
    });

    it('borra un dato opcional cuando llega nulo', async () => {
      const { id } = await servicio.crear({ ...nueva, diaRecogida: 'lunes' });

      const editada = await servicio.editar(id, { diaRecogida: null });

      expect(editada.diaRecogida).toBeNull();
    });

    it('valida igual que el alta', async () => {
      const { id } = await servicio.crear(nueva);

      await expect(servicio.editar(id, { nombre: ' ' })).rejects.toThrow(BadRequestException);
    });

    it('permite guardar su propio nombre y rechaza el de otra', async () => {
      const { id } = await servicio.crear(nueva);
      await servicio.crear({ ...nueva, nombre: 'Fundación Santa Ana' });

      await expect(servicio.editar(id, { nombre: 'Parroquia San José' })).resolves.toBeDefined();
      await expect(servicio.editar(id, { nombre: 'fundación santa ana' })).rejects.toThrow(
        ConflictException,
      );
    });

    it('responde 404 si no existe', async () => {
      await expect(servicio.editar('nada', { nombre: 'X' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('desactivar', () => {
    it('marca la institución como inactiva sin borrarla', async () => {
      const { id } = await servicio.crear(nueva);

      const desactivada = await servicio.desactivar(id);

      expect(desactivada.activa).toBe(false);
      expect(repositorio.instituciones).toHaveLength(1);
    });

    it('una institución desactivada deja de salir en el listado por defecto', async () => {
      const { id } = await servicio.crear(nueva);
      await servicio.desactivar(id);

      expect(await servicio.buscar()).toHaveLength(0);
      expect(await servicio.buscar({ incluirInactivas: true })).toHaveLength(1);
    });

    it('responde 404 si no existe', async () => {
      await expect(servicio.desactivar('nada')).rejects.toThrow(NotFoundException);
    });
  });
});
