import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ClaveParametro, ParametroListado, ParametroVigente } from '@sigba/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BodegasService, ParametrosLectura } from '../../plataforma/index.js';
import {
  type CargaDeSalida,
  type DatosDeSalida,
  type InstitucionParaSalida,
  type LoteParaSalida,
  type RegistrarSalida,
  type Salida,
  type SalidaRegistrada,
  SalidaSinStock,
  SalidasRepositorio,
} from './salida.js';
import { SalidasService } from './salidas.service.js';

/** Un UUIDv7 de prueba que se lee: id(3) termina en ...000000000003. */
function id(n: number): string {
  return `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

const INSTITUCION = id(1);
const BODEGA = id(3);
const ARROZ = id(12);
const PAN = id(13);
const LOTE_ARROZ = id(21);
const LOTE_PAN = id(22);
const LOTE_VENCIDO = id(23);

/**
 * Lleva el saldo de cada lote como el libro y reclama el comando como
 * `core.comando_procesado`: misma carga devuelve lo guardado, otra 409.
 */
class SalidasEnMemoria extends SalidasRepositorio {
  lotesDelBanco: LoteParaSalida[] = [];
  saldos = new Map<string, number>();
  guardadas = new Map<string, { carga: string; salida: Salida }>();
  escrituras: DatosDeSalida[] = [];

  async institucionesActivas(): Promise<InstitucionParaSalida[]> {
    return [{ id: INSTITUCION, nombre: 'Parroquia San José' }];
  }

  async lotes(ids: string[]): Promise<LoteParaSalida[]> {
    return this.lotesDelBanco.filter((l) => ids.includes(l.loteId));
  }

  async registrar(datos: DatosDeSalida): Promise<SalidaRegistrada> {
    const previa = await this.repetida(datos.comandoId, datos.carga);
    if (previa) return previa;

    const faltantes = datos.carga.detalles
      .filter((d) => (this.saldos.get(d.loteId) ?? 0) < Number(d.cantidad))
      .map((d) => ({
        loteId: d.loteId,
        referenciaId: d.referenciaId,
        solicitado: d.cantidad,
        disponible: String(this.saldos.get(d.loteId) ?? 0),
      }));
    if (faltantes.length > 0) throw new SalidaSinStock(faltantes);

    for (const d of datos.carga.detalles) {
      this.saldos.set(d.loteId, (this.saldos.get(d.loteId) ?? 0) - Number(d.cantidad));
    }
    this.escrituras.push(datos);
    const salida: Salida = {
      id: id(900 + this.escrituras.length),
      institucionId: datos.carga.institucionId,
      bodegaId: datos.carga.bodegaId,
      despachador: datos.despachador,
      despachadorTipo: datos.carga.despachadorTipo,
      aportePct: datos.aportePct,
      registradaEn: new Date('2026-10-15T15:00:00Z'),
      detalles: datos.carga.detalles.map((d, i) => ({
        ...d,
        categoriaId: 'categoria-1',
        kilos: datos.kilos[i] as string,
        valoracion: 'pendiente',
        valorUnitario: null,
        fuente: null,
        valorComercial: null,
        aporte: null,
      })),
    };
    this.guardadas.set(datos.comandoId, { carga: JSON.stringify(datos.carga), salida });
    return { salida, repetida: false };
  }

  async repetida(comandoId: string, carga: CargaDeSalida): Promise<SalidaRegistrada | null> {
    const previa = this.guardadas.get(comandoId);
    if (!previa) return null;
    if (previa.carga !== JSON.stringify(carga)) {
      throw new ConflictException('Este comando ya se procesó con otra carga.');
    }
    return { salida: previa.salida, repetida: true };
  }
}

class ParametrosEnMemoria extends ParametrosLectura {
  aporte: number | null = 8;

  async obtenerVigente<K extends ClaveParametro>(clave: K): Promise<ParametroVigente<K> | null> {
    if (clave !== 'aporte_solidario_pct' || this.aporte === null) return null;
    return {
      valor: this.aporte,
      version: 1,
      fecha_inicio: '2026-01-01',
      fecha_fin: null,
    } as ParametroVigente<K>;
  }

  async listarVigentes(): Promise<ParametroListado[]> {
    return [];
  }
}

describe('SalidasService', () => {
  let repositorio: SalidasEnMemoria;
  let parametros: ParametrosEnMemoria;
  let bodegasActivas: Set<string>;
  let servicio: SalidasService;

  const bodegas = {
    obtenerActiva: vi.fn(async (bodegaId: string) => {
      if (!bodegasActivas.has(bodegaId)) throw new NotFoundException('No existe esa bodega.');
      return { id: bodegaId, nombre: 'Santa Isabel' };
    }),
  };

  function comando(cambios: Partial<RegistrarSalida> = {}): RegistrarSalida {
    return {
      comandoId: id(100),
      institucionId: INSTITUCION,
      bodegaId: BODEGA,
      despachador: '  Operario de prueba ',
      despachadorTipo: 'funcionario',
      detalles: [
        { movimientoId: id(201), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '4' },
        { movimientoId: id(202), referenciaId: PAN, loteId: LOTE_PAN, cantidad: 2.5 },
      ],
      ...cambios,
    };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T02:00:00Z'));
    repositorio = new SalidasEnMemoria();
    repositorio.lotesDelBanco = [
      { loteId: LOTE_ARROZ, referenciaId: ARROZ, equivalenciaKg: '1', vencimiento: '2027-03-31' },
      { loteId: LOTE_PAN, referenciaId: PAN, equivalenciaKg: '0.4', vencimiento: '2026-10-15' },
      { loteId: LOTE_VENCIDO, referenciaId: PAN, equivalenciaKg: '0.4', vencimiento: '2026-10-14' },
    ];
    repositorio.saldos = new Map([
      [LOTE_ARROZ, 10],
      [LOTE_PAN, 5],
      [LOTE_VENCIDO, 5],
    ]);
    parametros = new ParametrosEnMemoria();
    bodegasActivas = new Set([BODEGA]);
    servicio = new SalidasService(repositorio, bodegas as unknown as BodegasService, parametros);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('escribe la salida con kilos del lote, aporte vigente y el día en Colombia', async () => {
    const { salida, repetida } = await servicio.registrar(comando());

    expect(repetida).toBe(false);
    expect(repositorio.escrituras).toEqual([
      {
        comandoId: id(100),
        carga: {
          institucionId: INSTITUCION,
          bodegaId: BODEGA,
          despachadorTipo: 'funcionario',
          detalles: [
            { movimientoId: id(201), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '4' },
            { movimientoId: id(202), referenciaId: PAN, loteId: LOTE_PAN, cantidad: '2.5' },
          ],
        },
        despachador: 'Operario de prueba',
        kilos: ['4', '1'],
        aportePct: '8',
        // 21:00 del 15 en Pereira: el pan que vence el 15 todavía sale.
        hoy: '2026-10-15',
      },
    ]);
    expect(salida.despachador).toBe('Operario de prueba');
    expect(repositorio.saldos.get(LOTE_ARROZ)).toBe(6);
  });

  it('sin aporte configurado lo deja pendiente, no en cero', async () => {
    parametros.aporte = null;

    await servicio.registrar(comando());

    expect(repositorio.escrituras[0]?.aportePct).toBeNull();
  });

  it('el mismo comando dos veces devuelve la misma salida y no descuenta dos veces', async () => {
    const primera = await servicio.registrar(comando());
    const segunda = await servicio.registrar(comando());

    expect(segunda).toEqual({ salida: primera.salida, repetida: true });
    expect(repositorio.escrituras).toHaveLength(1);
    expect(repositorio.saldos.get(LOTE_ARROZ)).toBe(6);
  });

  it('el mismo comando con otra carga responde 409', async () => {
    await servicio.registrar(comando());

    await expect(
      servicio.registrar(comando({ despachadorTipo: 'voluntario' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('el reenvío después de desactivar la bodega devuelve lo que ya quedó', async () => {
    const primera = await servicio.registrar(comando());
    bodegasActivas.clear();

    await expect(servicio.registrar(comando())).resolves.toEqual({
      salida: primera.salida,
      repetida: true,
    });
  });

  it('una bodega inactiva responde 404', async () => {
    bodegasActivas.clear();

    await expect(servicio.registrar(comando())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un lote de otra referencia o de otro banco responde 404', async () => {
    await expect(
      servicio.registrar(
        comando({
          detalles: [{ movimientoId: id(201), referenciaId: PAN, loteId: LOTE_ARROZ, cantidad: 1 }],
        }),
      ),
    ).rejects.toThrow('Fila 1: no existe ese lote o no es de esa referencia.');
    await expect(
      servicio.registrar(
        comando({
          detalles: [{ movimientoId: id(201), referenciaId: ARROZ, loteId: id(99), cantidad: 1 }],
        }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un lote vencido no se despacha: se da de baja', async () => {
    await expect(
      servicio.registrar(
        comando({
          detalles: [
            { movimientoId: id(201), referenciaId: PAN, loteId: LOTE_VENCIDO, cantidad: 1 },
          ],
        }),
      ),
    ).rejects.toThrow('Fila 1: el lote venció el 2026-10-14. Dalo de baja en vez de despacharlo.');
    expect(repositorio.escrituras).toHaveLength(0);
  });

  it('sin stock suficiente responde 409 con lo que falta de cada lote', async () => {
    const error = await servicio
      .registrar(
        comando({
          detalles: [
            { movimientoId: id(201), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '11' },
            { movimientoId: id(202), referenciaId: PAN, loteId: LOTE_PAN, cantidad: '1' },
          ],
        }),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SalidaSinStock);
    expect((error as SalidaSinStock).getResponse()).toMatchObject({
      statusCode: 409,
      codigo: 'sin_stock',
      faltantes: [{ loteId: LOTE_ARROZ, referenciaId: ARROZ, solicitado: '11', disponible: '10' }],
    });
    expect(repositorio.saldos.get(LOTE_PAN)).toBe(5);
  });

  it.each<[string, Partial<RegistrarSalida>, string]>([
    ['sin filas', { detalles: [] }, 'La salida necesita al menos una fila.'],
    [
      'un tipo de despachador desconocido',
      { despachadorTipo: 'jefe' as never },
      'Tipo de despachador desconocido',
    ],
    ['sin despachador', { despachador: '   ' }, 'Falta quién despachó.'],
    ['un despachador demasiado largo', { despachador: 'x'.repeat(201) }, 'no puede pasar de 200'],
    [
      'una institución que no es UUID',
      { institucionId: 'parroquia' },
      'La institución no es un UUID válido.',
    ],
    [
      'una cantidad en cero',
      {
        detalles: [
          { movimientoId: id(201), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '0' },
        ],
      },
      'Fila 1: la cantidad debe ser mayor que cero',
    ],
    [
      'el mismo lote en dos filas',
      {
        detalles: [
          { movimientoId: id(201), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '1' },
          { movimientoId: id(202), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '1' },
        ],
      },
      'Fila 2: ese lote ya viene en otra fila',
    ],
    [
      'el mismo movimiento en dos filas',
      {
        detalles: [
          { movimientoId: id(201), referenciaId: ARROZ, loteId: LOTE_ARROZ, cantidad: '1' },
          { movimientoId: id(201), referenciaId: PAN, loteId: LOTE_PAN, cantidad: '1' },
        ],
      },
      'Fila 2: el movimiento ya viene en otra fila.',
    ],
  ])('rechaza con 400 %s', async (_caso, cambios, mensaje) => {
    const error = await servicio.registrar(comando(cambios)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toContain(mensaje);
    expect(repositorio.escrituras).toHaveLength(0);
  });

  it('lista las instituciones activas para elegir destinatario', async () => {
    await expect(servicio.institucionesActivas()).resolves.toEqual([
      { id: INSTITUCION, nombre: 'Parroquia San José' },
    ]);
  });
});
