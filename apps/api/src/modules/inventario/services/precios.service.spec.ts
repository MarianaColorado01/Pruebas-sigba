import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DatosDeAprobacion,
  type DatosDePrecio,
  type PrecioGuardado,
  type PrecioRegistrado,
  PreciosRepositorio,
  type ProponerPrecio,
} from './precio.js';
import { DIAS_DE_VIGENCIA, PreciosService } from './precios.service.js';

/** Un UUIDv7 de prueba que se lee: id(3) termina en ...000000000003. */
function id(n: number): string {
  return `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

function diaAnterior(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() - 1);
  return dia.toISOString().slice(0, 10);
}

/**
 * Reclama el comando como `core.comando_procesado` y aprueba como el
 * adaptador: cierra el aprobado anterior que se cruce y no borra nada.
 */
class PreciosEnMemoria extends PreciosRepositorio {
  precios: PrecioGuardado[] = [];
  comandos = new Map<string, { carga: string; precioId: string }>();
  escrituras = 0;

  private reclamar(comandoId: string, carga: unknown): PrecioGuardado | null {
    const previo = this.comandos.get(comandoId);
    if (!previo) return null;
    if (previo.carga !== JSON.stringify(carga)) {
      throw new ConflictException('Este comando ya se procesó con otra carga.');
    }
    return this.precios.find((p) => p.id === previo.precioId) ?? null;
  }

  async proponer({ comandoId, carga, vigenteHasta }: DatosDePrecio): Promise<PrecioRegistrado> {
    const previo = this.reclamar(comandoId, carga);
    if (previo) return { precio: previo, repetida: true };

    this.escrituras += 1;
    const precio: PrecioGuardado = {
      ...carga,
      id: id(1000 + this.precios.length),
      vigenteHasta,
      estado: 'propuesto',
      motivoFueraDeBanda: null,
      aprobadoPor: null,
      aprobadoEn: null,
      creadoPor: 'coordinacion',
      creadoEn: new Date('2026-10-15T15:00:00Z'),
    };
    this.precios.push(precio);
    this.comandos.set(comandoId, { carga: JSON.stringify(carga), precioId: precio.id });
    return { precio, repetida: false };
  }

  async obtener(id: string): Promise<PrecioGuardado | null> {
    return this.precios.find((p) => p.id === id) ?? null;
  }

  async aprobar({ comandoId, carga }: DatosDeAprobacion): Promise<PrecioRegistrado> {
    const previo = this.reclamar(comandoId, carga);
    if (previo) return { precio: previo, repetida: true };

    const precio = this.precios.find((p) => p.id === carga.precioId);
    if (!precio) throw new NotFoundException('No existe ese precio.');
    if (precio.estado !== 'propuesto') throw new ConflictException('Ese precio ya está aprobado.');

    this.escrituras += 1;
    for (const anterior of this.precios) {
      if (
        anterior.estado === 'aprobado' &&
        anterior.referenciaId === precio.referenciaId &&
        anterior.vigenteDesde < precio.vigenteDesde &&
        (anterior.vigenteHasta === null || anterior.vigenteHasta >= precio.vigenteDesde)
      ) {
        anterior.vigenteHasta = diaAnterior(precio.vigenteDesde);
      }
    }
    Object.assign(precio, {
      estado: 'aprobado',
      motivoFueraDeBanda: carga.motivoFueraDeBanda,
      aprobadoPor: 'coordinacion',
      aprobadoEn: new Date('2026-10-15T16:00:00Z'),
    });
    this.comandos.set(comandoId, { carga: JSON.stringify(carga), precioId: precio.id });
    return { precio, repetida: false };
  }

  async historial(referenciaId: string): Promise<PrecioGuardado[]> {
    return this.precios
      .filter((p) => p.referenciaId === referenciaId)
      .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde));
  }

  async aprobadoEn(referenciaId: string, fecha: string): Promise<PrecioGuardado | null> {
    return (
      this.precios.find(
        (p) =>
          p.referenciaId === referenciaId &&
          p.estado === 'aprobado' &&
          p.vigenteDesde <= fecha &&
          (p.vigenteHasta === null || p.vigenteHasta >= fecha),
      ) ?? null
    );
  }
}

const ARROZ_500G = id(11);
const ACEITE_1L = id(12);

function propuesta(cambios: Partial<ProponerPrecio> = {}): ProponerPrecio {
  return {
    comandoId: id(50),
    referenciaId: ARROZ_500G,
    valor: '2800',
    piso: 2500,
    techo: '3200.00',
    fuente: 'sipsa',
    evidencia: 'SIPSA-P Pereira, semana 41',
    vigenteDesde: '2026-10-01',
    vigenteHasta: '2026-10-31',
    ...cambios,
  };
}

describe('PreciosService', () => {
  let repositorio: PreciosEnMemoria;
  let servicio: PreciosService;
  let siguiente = 100;

  /** Propone y aprueba con comandos nuevos; devuelve el id del precio. */
  async function aprobado(cambios: Partial<ProponerPrecio> = {}, motivo?: string) {
    const { precio } = await servicio.proponer(
      propuesta({ comandoId: id(siguiente++), ...cambios }),
    );
    await servicio.aprobar({
      comandoId: id(siguiente++),
      precioId: precio.id,
      motivoFueraDeBanda: motivo ?? null,
    });
    return precio.id;
  }

  beforeEach(() => {
    // 15 de octubre de 2026 a las 10 a. m. en Colombia.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'));
    repositorio = new PreciosEnMemoria();
    servicio = new PreciosService(repositorio);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('proponer', () => {
    it('guarda la propuesta limpia, en estado propuesto', async () => {
      const { precio, repetida } = await servicio.proponer(
        propuesta({ evidencia: '  Remisión 778  ', valor: 2800.5 }),
      );

      expect(repetida).toBe(false);
      expect(precio).toMatchObject({
        referenciaId: ARROZ_500G,
        valor: '2800.5',
        piso: '2500',
        techo: '3200',
        fuente: 'sipsa',
        evidencia: 'Remisión 778',
        vigenteDesde: '2026-10-01',
        vigenteHasta: '2026-10-31',
        estado: 'propuesto',
      });
    });

    it(`sin fin de vigencia, dura ${DIAS_DE_VIGENCIA} días contando el primero, y la carga no lo incluye`, async () => {
      const escritas: DatosDePrecio[] = [];
      const proponer = repositorio.proponer.bind(repositorio);
      repositorio.proponer = (datos) => {
        escritas.push(datos);
        return proponer(datos);
      };

      const { precio } = await servicio.proponer(propuesta({ vigenteHasta: null }));

      expect(DIAS_DE_VIGENCIA).toBe(30);
      expect(precio.vigenteHasta).toBe('2026-10-30');
      expect(escritas[0]?.carga.vigenteHasta).toBeNull();
    });

    it('acepta un valor fuera de la banda: la banda se exige al aprobar', async () => {
      const { precio } = await servicio.proponer(propuesta({ valor: '4000' }));

      expect(precio.estado).toBe('propuesto');
    });

    it.each([0, -1, '0.00', '2,800', '1.234', 'mil', '1234567890123', ''])(
      'rechaza el valor %s',
      async (valor) => {
        await expect(servicio.proponer(propuesta({ valor }))).rejects.toThrow(
          'El valor debe ser mayor que cero, en pesos con punto decimal y hasta dos decimales.',
        );
      },
    );

    it('rechaza un piso mayor que el techo, o un piso o techo inválidos', async () => {
      await expect(servicio.proponer(propuesta({ piso: 3300 }))).rejects.toThrow(
        'El piso no puede ser mayor que el techo.',
      );
      await expect(servicio.proponer(propuesta({ piso: 0 }))).rejects.toThrow(
        'El piso debe ser mayor que cero',
      );
      await expect(servicio.proponer(propuesta({ techo: 'alto' }))).rejects.toThrow(
        'El techo debe ser mayor que cero',
      );
    });

    it('rechaza una fuente desconocida o sin evidencia', async () => {
      await expect(
        servicio.proponer(propuesta({ fuente: 'mercadolibre' as unknown as 'sipsa' })),
      ).rejects.toThrow('Fuente desconocida. Debe ser una de: remision, sipsa, catalogo, manual.');
      await expect(servicio.proponer(propuesta({ evidencia: '   ' }))).rejects.toThrow(
        'El precio necesita evidencia: de dónde sale el valor.',
      );
    });

    it('rechaza fechas inválidas o una vigencia que termina antes de empezar', async () => {
      await expect(servicio.proponer(propuesta({ vigenteDesde: '2026-02-30' }))).rejects.toThrow(
        'El inicio de vigencia no es una fecha válida (AAAA-MM-DD).',
      );
      await expect(servicio.proponer(propuesta({ vigenteHasta: '31/10/2026' }))).rejects.toThrow(
        'El fin de vigencia no es una fecha válida (AAAA-MM-DD).',
      );
      await expect(servicio.proponer(propuesta({ vigenteHasta: '2026-09-30' }))).rejects.toThrow(
        'La vigencia no puede terminar antes de empezar.',
      );
    });

    it('rechaza identificadores que no son UUID', async () => {
      await expect(servicio.proponer(propuesta({ comandoId: 'abc' }))).rejects.toThrow(
        'El comando no es un UUID válido.',
      );
      await expect(servicio.proponer(propuesta({ referenciaId: '' }))).rejects.toThrow(
        'La referencia no es un UUID válido.',
      );
    });

    it('el mismo comando con la misma carga devuelve el precio y no escribe otra vez', async () => {
      const primera = await servicio.proponer(propuesta());
      const segunda = await servicio.proponer(
        propuesta({ referenciaId: ARROZ_500G.toUpperCase(), valor: '2800.00' }),
      );

      expect(segunda.repetida).toBe(true);
      expect(segunda.precio).toEqual(primera.precio);
      expect(repositorio.escrituras).toBe(1);
    });

    it('el mismo comando con otra carga responde 409', async () => {
      await servicio.proponer(propuesta());

      await expect(servicio.proponer(propuesta({ valor: '2900' }))).rejects.toThrow(
        ConflictException,
      );
      expect(repositorio.escrituras).toBe(1);
    });
  });

  describe('aprobar', () => {
    it('aprueba un propuesto dentro de la banda sin pedir motivo', async () => {
      const { precio } = await servicio.proponer(propuesta());

      const aprobacion = await servicio.aprobar({ comandoId: id(60), precioId: precio.id });

      expect(aprobacion.repetida).toBe(false);
      expect(aprobacion.precio).toMatchObject({ estado: 'aprobado', motivoFueraDeBanda: null });
    });

    // Criterio 2.
    it.each(['2499.99', '3200.01'])(
      'exige motivo para aprobar el valor %s, fuera de la banda',
      async (valor) => {
        const { precio } = await servicio.proponer(propuesta({ valor }));

        for (const motivo of [undefined, null, '   ']) {
          await expect(
            servicio.aprobar({
              comandoId: id(60),
              precioId: precio.id,
              motivoFueraDeBanda: motivo,
            }),
          ).rejects.toThrow(
            `El valor ${valor} está fuera de la banda de 2500 a 3200. Para aprobarlo escribe el motivo.`,
          );
        }
        expect((await repositorio.obtener(precio.id))?.estado).toBe('propuesto');
      },
    );

    it('aprueba fuera de la banda con motivo y lo guarda', async () => {
      const { precio } = await servicio.proponer(propuesta({ valor: '4000' }));

      const { precio: aprobado } = await servicio.aprobar({
        comandoId: id(60),
        precioId: precio.id,
        motivoFueraDeBanda: '  Alza por el paro camionero  ',
      });

      expect(aprobado).toMatchObject({
        estado: 'aprobado',
        motivoFueraDeBanda: 'Alza por el paro camionero',
      });
    });

    it('el piso y el techo cuentan como dentro de la banda', async () => {
      await expect(aprobado({ valor: '2500' })).resolves.toBeDefined();
      await expect(
        aprobado({ valor: '3200', vigenteDesde: '2026-11-01', vigenteHasta: null }),
      ).resolves.toBeDefined();
    });

    it('responde 404 si el precio no existe, o no es del banco', async () => {
      await expect(servicio.aprobar({ comandoId: id(60), precioId: id(99) })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rechaza identificadores que no son UUID', async () => {
      await expect(servicio.aprobar({ comandoId: id(60), precioId: 'p-1' })).rejects.toThrow(
        'El precio no es un UUID válido.',
      );
    });

    it('el reenvío de la aprobación devuelve lo mismo; otra carga responde 409', async () => {
      const { precio } = await servicio.proponer(propuesta({ valor: '4000' }));
      const comando = { comandoId: id(60), precioId: precio.id, motivoFueraDeBanda: 'Alza' };

      await servicio.aprobar(comando);
      const reenvio = await servicio.aprobar(comando);

      expect(reenvio.repetida).toBe(true);
      await expect(servicio.aprobar({ ...comando, motivoFueraDeBanda: 'Otro' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('vigente', () => {
    // Criterio 1.
    it('un propuesto sin aprobar deja la valoración pendiente y no usa su valor', async () => {
      await servicio.proponer(propuesta());

      expect(await servicio.vigente(ARROZ_500G, '2026-10-15')).toEqual({
        referenciaId: ARROZ_500G,
        fecha: '2026-10-15',
        valoracion: 'pendiente',
        precio: null,
      });
    });

    it('un aprobado vigente se usa', async () => {
      const precioId = await aprobado();

      const resultado = await servicio.vigente(ARROZ_500G, '2026-10-31');

      expect(resultado).toMatchObject({ valoracion: 'con_precio' });
      expect(resultado.precio).toMatchObject({ id: precioId, valor: '2800', estado: 'aprobado' });
    });

    // Criterio 3.
    it('un aprobado vencido no se usa ni se sustituye por cero', async () => {
      await aprobado({ vigenteHasta: '2026-10-10' });

      const resultado = await servicio.vigente(ARROZ_500G, '2026-10-11');

      expect(resultado).toMatchObject({ valoracion: 'pendiente', precio: null });
    });

    it('sin fecha consulta el día de hoy en Colombia', async () => {
      // 11 p. m. del 31 de octubre en Colombia, ya 1 de noviembre en UTC.
      vi.setSystemTime(new Date('2026-11-01T04:00:00Z'));
      await aprobado();

      expect(await servicio.vigente(ARROZ_500G)).toMatchObject({
        fecha: '2026-10-31',
        valoracion: 'con_precio',
      });
    });

    it('rechaza una fecha o una referencia inválidas', async () => {
      await expect(servicio.vigente(ARROZ_500G, '15/10/2026')).rejects.toThrow(BadRequestException);
      await expect(servicio.vigente('arroz')).rejects.toThrow(
        'La referencia no es un UUID válido.',
      );
    });
  });

  describe('historial', () => {
    it('aprobar uno nuevo cierra el anterior sin borrarlo, y el estado se deriva de hoy', async () => {
      const setiembre = await aprobado({
        vigenteDesde: '2026-09-01',
        vigenteHasta: '2026-09-30',
      });
      const octubre = await aprobado({ vigenteDesde: '2026-10-01', vigenteHasta: null });
      const quincena = await aprobado({ valor: '3000', vigenteDesde: '2026-10-16' });
      const { precio: propuesto } = await servicio.proponer(
        propuesta({ comandoId: id(70), vigenteDesde: '2026-11-01', vigenteHasta: null }),
      );
      await servicio.proponer(propuesta({ comandoId: id(71), referenciaId: ACEITE_1L }));

      const historial = await servicio.historial(ARROZ_500G);

      expect(historial.map((p) => [p.id, p.estado, p.vigenteDesde, p.vigenteHasta])).toEqual([
        [propuesto.id, 'propuesto', '2026-11-01', '2026-11-30'],
        [quincena, 'aprobado', '2026-10-16', '2026-10-31'],
        [octubre, 'aprobado', '2026-10-01', '2026-10-15'],
        [setiembre, 'vencido', '2026-09-01', '2026-09-30'],
      ]);
    });

    it('un aprobado que termina hoy sigue vigente; mañana queda vencido', async () => {
      await aprobado({ vigenteHasta: '2026-10-15' });

      expect((await servicio.historial(ARROZ_500G))[0]?.estado).toBe('aprobado');
      vi.setSystemTime(new Date('2026-10-16T15:00:00Z'));
      expect((await servicio.historial(ARROZ_500G))[0]?.estado).toBe('vencido');
    });

    it('rechaza una referencia que no es UUID', async () => {
      await expect(servicio.historial('arroz')).rejects.toThrow(
        'La referencia no es un UUID válido.',
      );
    });
  });
});
