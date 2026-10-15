import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Bodega, BodegasService } from '../../plataforma/index.js';
import { type BusquedaDeDonantes, type Donante, DonantesRepositorio } from './donante.js';
import { DonantesService } from './donantes.service.js';
import {
  type DatosDeRecepcion,
  type FilaDeRecepcion,
  type Recepcion,
  type RecepcionRegistrada,
  RecepcionesRepositorio,
  type RegistrarRecepcion,
} from './recepcion.js';
import { RecepcionesService } from './recepciones.service.js';
import {
  type BusquedaDeReferencias,
  type ReferenciaDelCatalogo,
  ReferenciasRepositorio,
} from './referencia.js';
import { ReferenciasService } from './referencias.service.js';

/** Un UUIDv7 de prueba que se lee: id(3) termina en ...000000000003. */
function id(n: number): string {
  return `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

function noUsado(): never {
  throw new Error('La recepción no usa este método.');
}

/**
 * Guarda lo que recibe para que la prueba lo mire. Reclama el comando como
 * `core.comando_procesado`: misma carga devuelve lo guardado, otra responde 409.
 */
class RecepcionesEnMemoria extends RecepcionesRepositorio {
  guardadas = new Map<string, { carga: string; recepcion: Recepcion }>();
  escrituras: DatosDeRecepcion[] = [];

  async registrar(datos: DatosDeRecepcion): Promise<RecepcionRegistrada> {
    const carga = JSON.stringify(datos.carga);
    const previa = this.guardadas.get(datos.comandoId);
    if (previa) {
      if (previa.carga !== carga) {
        throw new ConflictException('Este comando ya se procesó con otra carga.');
      }
      return { recepcion: previa.recepcion, repetida: true };
    }

    this.escrituras.push(datos);
    const { detalles, ...cabecera } = datos.carga;
    const recepcion: Recepcion = {
      id: `recepcion-${this.escrituras.length}`,
      ...cabecera,
      registradaEn: new Date('2026-09-30T15:00:00Z'),
      detalles: detalles.map((detalle, i) => ({
        ...detalle,
        kilos: datos.kilos[i] ?? '',
        loteId: `lote-${i + 1}`,
        valoracion: 'pendiente',
      })),
    };
    this.guardadas.set(datos.comandoId, { carga, recepcion });
    return { recepcion, repetida: false };
  }

  async repetida(comandoId: string, cargaDeRecepcion: object): Promise<RecepcionRegistrada | null> {
    const previa = this.guardadas.get(comandoId);
    if (!previa) return null;
    if (previa.carga !== JSON.stringify(cargaDeRecepcion)) {
      throw new ConflictException('Este comando ya se procesó con otra carga.');
    }
    return { recepcion: previa.recepcion, repetida: true };
  }
}

/** Las bodegas activas del banco; cualquier otro id es de otro banco, no existe o está desactivada. */
class BodegasEnMemoria extends BodegasService {
  activas: Bodega[] = [];

  constructor() {
    super(undefined as never);
  }

  override async obtenerActiva(id: string): Promise<Bodega> {
    const bodega = this.activas.find((b) => b.id === id);
    if (!bodega) throw new NotFoundException('No existe esa bodega o está desactivada.');
    return bodega;
  }
}

class DonantesEnMemoria extends DonantesRepositorio {
  donantes: Donante[] = [];

  async buscar({ id, soloActivos }: BusquedaDeDonantes): Promise<Donante[]> {
    return this.donantes.filter((d) => (!id || d.id === id) && (!soloActivos || d.activo));
  }

  async crear(): Promise<never> {
    return noUsado();
  }

  async actualizar(): Promise<never> {
    return noUsado();
  }
}

class CatalogoEnMemoria extends ReferenciasRepositorio {
  referencias: ReferenciaDelCatalogo[] = [];

  async buscar({ ids, soloActivas }: BusquedaDeReferencias): Promise<ReferenciaDelCatalogo[]> {
    return this.referencias.filter(
      (r) => (!ids || ids.includes(r.id)) && (!soloActivas || r.activa),
    );
  }

  async catalogo(): Promise<never> {
    return noUsado();
  }
  async crearCategoria(): Promise<never> {
    return noUsado();
  }
  async actualizarCategoria(): Promise<never> {
    return noUsado();
  }
  async crearProducto(): Promise<never> {
    return noUsado();
  }
  async actualizarProducto(): Promise<never> {
    return noUsado();
  }
  async crearReferencia(): Promise<never> {
    return noUsado();
  }
  async crearDesdeCelular(): Promise<never> {
    return noUsado();
  }
  async similares(): Promise<never> {
    return noUsado();
  }
  async actualizarReferencia(): Promise<never> {
    return noUsado();
  }
}

function referencia(n: number, presentacion: string, equivalenciaKg: string, activa = true) {
  return {
    id: id(n),
    presentacion,
    equivalenciaKg,
    creadaDesdeCelular: false,
    activa,
    producto: { id: id(900 + n), nombre: 'Arroz' },
    categoria: { id: id(999), codigo: 'C801', nombre: 'Arroz', linea: 'Cereales' },
  };
}

const DONANTE = id(1);
const DONANTE_INACTIVO = id(2);
const BODEGA = id(3);
const ARROBA = id(11);
const KILO = id(12);
const MEDIO = id(13);
const LITRO = id(14);
const TERCIO = id(15);
const DESACTIVADA = id(16);

function fila(n: number, cambios: Partial<FilaDeRecepcion> = {}): FilaDeRecepcion {
  return {
    movimientoId: id(100 + n),
    referenciaId: KILO,
    cantidad: 1,
    lote: `L-${n}`,
    vencimiento: '2027-03-31',
    ...cambios,
  };
}

/** Cinco referencias, como la del criterio de aceptación. */
function comando(cambios: Partial<RegistrarRecepcion> = {}): RegistrarRecepcion {
  return {
    comandoId: id(50),
    donanteId: DONANTE,
    origen: 'propia',
    bodegaId: BODEGA,
    detalles: [
      fila(1, { referenciaId: ARROBA, cantidad: 4 }),
      fila(2, { referenciaId: KILO, cantidad: '10' }),
      fila(3, { referenciaId: MEDIO, cantidad: '2.5' }),
      fila(4, { referenciaId: LITRO, cantidad: 12, lote: null, novedad: 'reempacado' }),
      fila(5, { referenciaId: TERCIO, cantidad: 3, novedad: 'roto' }),
    ],
    ...cambios,
  };
}

describe('RecepcionesService', () => {
  let recepciones: RecepcionesEnMemoria;
  let donantes: DonantesEnMemoria;
  let catalogo: CatalogoEnMemoria;
  let bodegas: BodegasEnMemoria;
  let servicio: RecepcionesService;

  beforeEach(() => {
    recepciones = new RecepcionesEnMemoria();
    donantes = new DonantesEnMemoria();
    donantes.donantes = [
      { id: DONANTE, nombre: 'Supermercado La 14', tipo: 'empresa', contacto: null, activo: true },
      { id: DONANTE_INACTIVO, nombre: 'Cerrado', tipo: 'empresa', contacto: null, activo: false },
    ];
    bodegas = new BodegasEnMemoria();
    bodegas.activas = [{ id: BODEGA, nombre: 'Santa Isabel' }];
    catalogo = new CatalogoEnMemoria();
    catalogo.referencias = [
      referencia(11, 'arroba', '12.5'),
      referencia(12, '1 kg', '1'),
      referencia(13, '500 g', '0.5'),
      referencia(14, '1 L', '1.03'),
      referencia(15, '333 g', '0.333'),
      referencia(16, '2 kg', '2', false),
    ];
    servicio = new RecepcionesService(
      recepciones,
      new DonantesService(donantes),
      bodegas,
      new ReferenciasService(catalogo),
    );
  });

  describe('registrar', () => {
    it('cinco referencias dan cinco detalles, cada uno con su movimiento y su lote', async () => {
      const { recepcion, repetida } = await servicio.registrar(comando());

      expect(repetida).toBe(false);
      expect(recepcion).toMatchObject({
        donanteId: DONANTE,
        origen: 'propia',
        bodegaId: BODEGA,
      });
      expect(recepcion.detalles.map((d) => [d.movimientoId, d.loteId])).toEqual([
        [id(101), 'lote-1'],
        [id(102), 'lote-2'],
        [id(103), 'lote-3'],
        [id(104), 'lote-4'],
        [id(105), 'lote-5'],
      ]);
    });

    it('calcula los kilos como cantidad por equivalencia, sin errores de redondeo', async () => {
      const { recepcion } = await servicio.registrar(comando());

      expect(recepcion.detalles.map((d) => [d.cantidad, d.kilos])).toEqual([
        ['4', '50'],
        ['10', '10'],
        ['2.5', '1.25'],
        ['12', '12.36'],
        ['3', '0.999'],
      ]);
    });

    it('guarda lote, vencimiento y novedad de cada fila, y nulo lo que no llega', async () => {
      const { recepcion } = await servicio.registrar(
        comando({
          detalles: [
            fila(1, { lote: '  L-778 ', novedad: 'no_apto' }),
            fila(2, { lote: '   ', vencimiento: '2026-12-01' }),
          ],
        }),
      );

      expect(recepcion.detalles.map((d) => [d.lote, d.vencimiento, d.novedad])).toEqual([
        ['L-778', '2027-03-31', 'no_apto'],
        [null, '2026-12-01', null],
      ]);
    });

    it('acepta los tres orígenes', async () => {
      for (const [n, origen] of (['propia', 'abaco', 'plataforma'] as const).entries()) {
        const { recepcion } = await servicio.registrar(comando({ comandoId: id(60 + n), origen }));
        expect(recepcion.origen).toBe(origen);
      }
    });

    // Sin valor ni valoración: la fila nace pendiente en la base, nunca en cero (ADR-13).
    it('la carga es el comando validado del cliente, sin kilos ni valoración', async () => {
      await servicio.registrar(
        comando({ detalles: [fila(1, { referenciaId: MEDIO, cantidad: '2.50', lote: ' L-1 ' })] }),
      );

      expect(recepciones.escrituras[0]).toEqual({
        comandoId: id(50),
        carga: {
          donanteId: DONANTE,
          origen: 'propia',
          bodegaId: BODEGA,
          detalles: [
            {
              movimientoId: id(101),
              referenciaId: MEDIO,
              cantidad: '2.5',
              lote: 'L-1',
              vencimiento: '2027-03-31',
              novedad: null,
            },
          ],
        },
        kilos: ['1.25'],
        equivalencias: ['0.5'],
      });
    });
  });

  describe('validación', () => {
    it('rechaza una recepción sin filas', async () => {
      await expect(servicio.registrar(comando({ detalles: [] }))).rejects.toThrow(
        'La recepción necesita al menos una fila.',
      );
    });

    // «1.000» con coma de miles sería mil; la API no adivina formatos locales.
    it.each([0, -3, '0.000', '2,5', '1,000', 'diez', '1.2345', '12345678', Number.NaN, ''])(
      'rechaza la cantidad %s y dice en qué fila',
      async (cantidad) => {
        const detalles = [fila(1), fila(2, { cantidad })];

        await expect(servicio.registrar(comando({ detalles }))).rejects.toThrow(
          'Fila 2: la cantidad debe ser mayor que cero, con punto decimal y hasta tres decimales.',
        );
      },
    );

    it('deja el vencimiento nulo si el producto no trae fecha, como el aseo', async () => {
      const { recepcion } = await servicio.registrar(
        comando({
          detalles: [fila(1, { vencimiento: null }), fila(2, { vencimiento: '' })],
        }),
      );

      expect(recepcion.detalles.map((d) => d.vencimiento)).toEqual([null, null]);
    });

    it.each(['2026-02-30', '31/03/2027', '2027-3-31'])(
      'rechaza el vencimiento %s',
      async (vencimiento) => {
        await expect(
          servicio.registrar(comando({ detalles: [fila(1, { vencimiento })] })),
        ).rejects.toThrow('Fila 1: la fecha de vencimiento no es válida (AAAA-MM-DD).');
      },
    );

    it('rechaza un origen o una novedad que no existen', async () => {
      await expect(
        servicio.registrar(comando({ origen: 'bodega' as unknown as 'propia' })),
      ).rejects.toThrow('Origen desconocido. Debe ser uno de: propia, abaco, plataforma.');
      await expect(
        servicio.registrar(
          comando({ detalles: [fila(1, { novedad: 'mojado' as unknown as 'roto' })] }),
        ),
      ).rejects.toThrow('Fila 1: novedad desconocida. Debe ser una de: roto, reempacado, no_apto.');
    });

    it('rechaza identificadores que no son UUID', async () => {
      await expect(servicio.registrar(comando({ comandoId: 'abc' }))).rejects.toThrow(
        'El comando no es un UUID válido.',
      );
      await expect(servicio.registrar(comando({ bodegaId: '' }))).rejects.toThrow(
        'La bodega no es un UUID válido.',
      );
      await expect(
        servicio.registrar(comando({ detalles: [fila(1, { movimientoId: 'm-1' })] })),
      ).rejects.toThrow('Fila 1: el movimiento no es un UUID válido.');
    });

    it('rechaza dos filas con el mismo movimiento', async () => {
      const detalles = [fila(1), fila(2, { movimientoId: id(101) })];

      await expect(servicio.registrar(comando({ detalles }))).rejects.toThrow(
        'Fila 2: el movimiento ya viene en otra fila.',
      );
    });

    it('rechaza un lote más largo que la columna', async () => {
      await expect(
        servicio.registrar(comando({ detalles: [fila(1, { lote: 'L'.repeat(51) })] })),
      ).rejects.toThrow('Fila 1: el lote no puede pasar de 50 caracteres.');
    });

    it('responde 404 si el donante no existe o está desactivado', async () => {
      await expect(servicio.registrar(comando({ donanteId: id(7) }))).rejects.toThrow(
        NotFoundException,
      );
      await expect(servicio.registrar(comando({ donanteId: DONANTE_INACTIVO }))).rejects.toThrow(
        'No existe ese donante o está desactivado.',
      );
    });

    it('responde 404 y no escribe si la bodega no es del banco, no existe o está desactivada', async () => {
      await expect(servicio.registrar(comando({ bodegaId: id(8) }))).rejects.toThrow(
        'No existe esa bodega o está desactivada.',
      );
      expect(recepciones.escrituras).toHaveLength(0);
    });

    it('responde 404 si una referencia no existe o está desactivada, con su fila', async () => {
      await expect(
        servicio.registrar(comando({ detalles: [fila(1), fila(2, { referenciaId: id(77) })] })),
      ).rejects.toThrow('Fila 2: no existe esa referencia o está desactivada.');
      await expect(
        servicio.registrar(comando({ detalles: [fila(1, { referenciaId: DESACTIVADA })] })),
      ).rejects.toThrow(NotFoundException);
    });

    it('no escribe nada si alguna fila falla', async () => {
      const detalles = [fila(1), fila(2), fila(3, { cantidad: 0 })];

      await expect(servicio.registrar(comando({ detalles }))).rejects.toThrow(BadRequestException);
      expect(recepciones.escrituras).toEqual([]);
    });
  });

  // El reclamo y la carrera entre dos envíos los prueba core
  // (idempotencia.service.spec.ts e idempotencia.integracion.spec.ts). Aquí,
  // lo que el servicio le entrega para que el reclamo funcione.
  describe('idempotencia', () => {
    it('el mismo comando con la misma carga devuelve el resultado anterior y no escribe otra vez', async () => {
      const primera = await servicio.registrar(comando());
      const segunda = await servicio.registrar(comando());

      expect(segunda.repetida).toBe(true);
      expect(segunda.recepcion).toEqual(primera.recepcion);
      expect(recepciones.escrituras).toHaveLength(1);
    });

    it('la misma carga escrita de otra forma es la misma carga', async () => {
      await servicio.registrar(comando());
      const reescrita = comando({ donanteId: DONANTE.toUpperCase() });
      reescrita.detalles = reescrita.detalles.map((d) => ({
        ...d,
        cantidad: String(d.cantidad).replace('2.5', '2.50'),
        lote: d.lote ? ` ${d.lote} ` : d.lote,
      }));

      expect((await servicio.registrar(reescrita)).repetida).toBe(true);
    });

    it('el mismo comando con otra carga responde 409 y no escribe', async () => {
      await servicio.registrar(comando());
      const otra = comando();
      otra.detalles[1] = fila(2, { cantidad: 11 });

      await expect(servicio.registrar(otra)).rejects.toThrow(ConflictException);
      expect(recepciones.escrituras).toHaveLength(1);
    });

    it('un reenvío después de desactivar el donante devuelve la recepción ya registrada', async () => {
      const primera = await servicio.registrar(comando());
      donantes.donantes = donantes.donantes.map((d) => ({ ...d, activo: false }));

      const reenvio = await servicio.registrar(comando());

      expect(reenvio).toEqual({ recepcion: primera.recepcion, repetida: true });
      expect(recepciones.escrituras).toHaveLength(1);
    });

    it('un reenvío después de desactivar una referencia devuelve la recepción ya registrada', async () => {
      await servicio.registrar(comando());
      catalogo.referencias = catalogo.referencias.map((r) => ({ ...r, activa: false }));

      expect((await servicio.registrar(comando())).repetida).toBe(true);
    });

    it('con el donante desactivado, otra carga con el mismo comando responde 409', async () => {
      await servicio.registrar(comando());
      donantes.donantes = donantes.donantes.map((d) => ({ ...d, activo: false }));
      const otra = comando();
      otra.detalles[1] = fila(2, { cantidad: 11 });

      await expect(servicio.registrar(otra)).rejects.toThrow(ConflictException);
    });

    it('un comando nuevo con el donante desactivado sigue respondiendo 404', async () => {
      await expect(servicio.registrar(comando({ donanteId: DONANTE_INACTIVO }))).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
