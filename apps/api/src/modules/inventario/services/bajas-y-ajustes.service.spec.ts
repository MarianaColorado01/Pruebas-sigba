import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Bodega, BodegasService } from '../../plataforma/index.js';
import {
  BajasYAjustesRepositorio,
  type CargaDeMovimientoManual,
  type DatosDeMovimientoManual,
  type MovimientoManual,
  type MovimientoManualRegistrado,
  type RegistrarAjuste,
  type RegistrarBaja,
} from './baja-y-ajuste.js';
import { BajasYAjustesService } from './bajas-y-ajustes.service.js';

/** Un UUIDv7 de prueba que se lee: id(3) termina en ...000000000003. */
function id(n: number): string {
  return `01920000-0000-7000-8000-${String(n).padStart(12, '0')}`;
}

const BODEGA = id(3);
const KILO = id(12);
const TERCIO = id(15);
const LOTE_DE_KILO = id(21);
const LOTE_DE_TERCIO = id(22);

/**
 * Lleva el saldo de cada lote como el libro: suma la cantidad con signo y
 * rechaza con 409 lo que lo dejaría en negativo. Reclama el comando como
 * `core.comando_procesado`: misma carga devuelve lo guardado, otra responde 409.
 */
class BajasYAjustesEnMemoria extends BajasYAjustesRepositorio {
  equivalencias = new Map<string, { referenciaId: string; equivalenciaKg: string }>();
  saldos = new Map<string, number>();
  guardados = new Map<string, { tipo: string; carga: string; movimiento: MovimientoManual }>();
  escrituras: DatosDeMovimientoManual[] = [];

  async equivalenciaDelLote(loteId: string, referenciaId: string): Promise<string | null> {
    const lote = this.equivalencias.get(loteId);
    return lote?.referenciaId === referenciaId ? lote.equivalenciaKg : null;
  }

  async registrar(datos: DatosDeMovimientoManual): Promise<MovimientoManualRegistrado> {
    const carga = JSON.stringify(datos.carga);
    const previo = this.guardados.get(datos.comandoId);
    if (previo) {
      if (previo.tipo !== datos.tipo || previo.carga !== carga) {
        throw new ConflictException('Este comando ya se procesó con otra carga.');
      }
      return { movimiento: previo.movimiento, repetida: true };
    }

    const { loteId } = datos.carga;
    if (datos.tipo === 'ajuste' && Number(datos.carga.cantidad) > 0 && !this.saldos.has(loteId)) {
      throw new ConflictException('Ese lote nunca estuvo en esa bodega.');
    }
    const saldo = (this.saldos.get(loteId) ?? 0) + Number(datos.carga.cantidad);
    if (saldo < 0) throw new ConflictException('No hay saldo suficiente en ese lote y bodega.');

    this.saldos.set(loteId, saldo);
    this.escrituras.push(datos);
    const movimiento: MovimientoManual = {
      ...datos.carga,
      tipo: datos.tipo,
      kilos: datos.kilos,
      registradoEn: new Date('2026-10-15T15:00:00Z'),
    };
    this.guardados.set(datos.comandoId, { tipo: datos.tipo, carga, movimiento });
    return { movimiento, repetida: false };
  }

  async repetido(
    tipo: string,
    comandoId: string,
    carga: CargaDeMovimientoManual,
  ): Promise<MovimientoManualRegistrado | null> {
    const previo = this.guardados.get(comandoId);
    if (!previo) return null;
    if (previo.tipo !== tipo || previo.carga !== JSON.stringify(carga)) {
      throw new ConflictException('Este comando ya se procesó con otra carga.');
    }
    return { movimiento: previo.movimiento, repetida: true };
  }
}

class BodegasEnMemoria extends BodegasService {
  activas: Bodega[] = [{ id: BODEGA, nombre: 'Santa Isabel' }];

  constructor() {
    super(undefined as never);
  }

  override async obtenerActiva(id: string): Promise<Bodega> {
    const bodega = this.activas.find((b) => b.id === id);
    if (!bodega) throw new NotFoundException('No existe esa bodega o está desactivada.');
    return bodega;
  }
}

function baja(cambios: Partial<RegistrarBaja> = {}): RegistrarBaja {
  return {
    comandoId: id(50),
    movimientoId: id(101),
    bodegaId: BODEGA,
    referenciaId: KILO,
    loteId: LOTE_DE_KILO,
    cantidad: 10,
    motivo: 'vencido',
    ...cambios,
  };
}

function ajuste(cambios: Partial<RegistrarAjuste> = {}): RegistrarAjuste {
  return {
    comandoId: id(60),
    movimientoId: id(201),
    bodegaId: BODEGA,
    referenciaId: KILO,
    loteId: LOTE_DE_KILO,
    cantidad: '-3',
    motivo: 'Conteo de cierre: faltaban tres bolsas',
    ...cambios,
  };
}

describe('BajasYAjustesService', () => {
  let repositorio: BajasYAjustesEnMemoria;
  let bodegas: BodegasEnMemoria;
  let servicio: BajasYAjustesService;

  beforeEach(() => {
    repositorio = new BajasYAjustesEnMemoria();
    repositorio.equivalencias.set(LOTE_DE_KILO, { referenciaId: KILO, equivalenciaKg: '1' });
    repositorio.equivalencias.set(LOTE_DE_TERCIO, {
      referenciaId: TERCIO,
      equivalenciaKg: '0.333',
    });
    repositorio.saldos.set(LOTE_DE_KILO, 25);
    repositorio.saldos.set(LOTE_DE_TERCIO, 25);
    bodegas = new BodegasEnMemoria();
    servicio = new BajasYAjustesService(repositorio, bodegas);
  });

  describe('baja', () => {
    it('una baja de 10 unidades baja 10 el saldo del lote y guarda su motivo', async () => {
      const { movimiento, repetida } = await servicio.darDeBaja(baja());

      expect(repetida).toBe(false);
      expect(movimiento).toMatchObject({
        tipo: 'baja',
        loteId: LOTE_DE_KILO,
        cantidad: '-10',
        kilos: '-10',
        motivo: 'vencido',
      });
      expect(repositorio.saldos.get(LOTE_DE_KILO)).toBe(15);
    });

    it('acepta los cuatro motivos', async () => {
      for (const [n, motivo] of (['vencido', 'no_apto', 'roto', 'perdida'] as const).entries()) {
        const { movimiento } = await servicio.darDeBaja(
          baja({ comandoId: id(70 + n), movimientoId: id(170 + n), cantidad: 1, motivo }),
        );
        expect(movimiento.motivo).toBe(motivo);
      }
    });

    it('calcula los kilos con la equivalencia de la referencia del lote, sin redondeo', async () => {
      const { movimiento } = await servicio.darDeBaja(
        baja({ referenciaId: TERCIO, loteId: LOTE_DE_TERCIO, cantidad: '3' }),
      );

      expect([movimiento.cantidad, movimiento.kilos]).toEqual(['-3', '-0.999']);
    });

    it('una baja mayor que el saldo responde 409 y no mueve el lote', async () => {
      await expect(servicio.darDeBaja(baja({ cantidad: 26 }))).rejects.toThrow(ConflictException);
      expect(repositorio.saldos.get(LOTE_DE_KILO)).toBe(25);
    });

    // El signo lo pone el servidor: una baja negativa sería una entrada disfrazada.
    it.each([0, -10, '0.000', '2,5', 'diez', '1.2345', ''])(
      'rechaza la cantidad %s',
      async (cantidad) => {
        await expect(servicio.darDeBaja(baja({ cantidad }))).rejects.toThrow(
          'La cantidad de la baja debe ser mayor que cero, con punto decimal y hasta tres decimales.',
        );
      },
    );

    it('rechaza un motivo que no está en la lista', async () => {
      await expect(
        servicio.darDeBaja(baja({ motivo: 'mojado' as unknown as 'roto' })),
      ).rejects.toThrow(
        'Motivo de baja desconocido. Debe ser uno de: vencido, no_apto, roto, perdida.',
      );
      expect(repositorio.escrituras).toEqual([]);
    });
  });

  describe('ajuste', () => {
    it('un ajuste negativo resta y uno positivo suma, cada uno con su motivo', async () => {
      const faltante = await servicio.ajustar(ajuste());
      const sobrante = await servicio.ajustar(
        ajuste({
          comandoId: id(61),
          movimientoId: id(202),
          cantidad: 1.5,
          motivo: 'Apareció una caja detrás del estante',
        }),
      );

      expect(faltante.movimiento).toMatchObject({ tipo: 'ajuste', cantidad: '-3', kilos: '-3' });
      expect(sobrante.movimiento).toMatchObject({
        cantidad: '1.5',
        motivo: 'Apareció una caja detrás del estante',
      });
      expect(repositorio.saldos.get(LOTE_DE_KILO)).toBe(23.5);
    });

    it.each([undefined, null, '', '   '])('rechaza un ajuste sin motivo (%s)', async (motivo) => {
      await expect(
        servicio.ajustar(ajuste({ motivo: motivo as unknown as string })),
      ).rejects.toThrow('El ajuste necesita un motivo.');
      expect(repositorio.escrituras).toEqual([]);
    });

    it('guarda el motivo sin los espacios de los extremos', async () => {
      const { movimiento } = await servicio.ajustar(ajuste({ motivo: '  Conteo de cierre ' }));

      expect(movimiento.motivo).toBe('Conteo de cierre');
    });

    it('rechaza un motivo más largo que la columna', async () => {
      await expect(servicio.ajustar(ajuste({ motivo: 'x'.repeat(501) }))).rejects.toThrow(
        'El motivo del ajuste no puede pasar de 500 caracteres.',
      );
    });

    it.each([0, '-0', '+3', '--3', '1,5', 'tres', ''])(
      'rechaza la cantidad %s',
      async (cantidad) => {
        await expect(servicio.ajustar(ajuste({ cantidad }))).rejects.toThrow(
          'La cantidad del ajuste no puede ser cero: positiva si sobra, negativa si falta, con punto decimal y hasta tres decimales.',
        );
      },
    );

    it('un ajuste positivo de un lote que nunca estuvo en esa bodega responde 409', async () => {
      const loteSinSaldo = id(23);
      repositorio.equivalencias.set(loteSinSaldo, { referenciaId: KILO, equivalenciaKg: '1' });

      await expect(
        servicio.ajustar(ajuste({ loteId: loteSinSaldo, cantidad: '2' })),
      ).rejects.toThrow(ConflictException);
      expect(repositorio.escrituras).toHaveLength(0);
    });

    it('un ajuste negativo mayor que el saldo responde 409', async () => {
      await expect(servicio.ajustar(ajuste({ cantidad: '-25.001' }))).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('validación común', () => {
    it('rechaza identificadores que no son UUID', async () => {
      await expect(servicio.darDeBaja(baja({ comandoId: 'abc' }))).rejects.toThrow(
        'El comando no es un UUID válido.',
      );
      await expect(servicio.ajustar(ajuste({ movimientoId: 'm-1' }))).rejects.toThrow(
        'El movimiento no es un UUID válido.',
      );
      await expect(servicio.darDeBaja(baja({ loteId: '' }))).rejects.toThrow(
        'El lote no es un UUID válido.',
      );
    });

    it('responde 404 y no escribe si la bodega no es del banco, no existe o está desactivada', async () => {
      await expect(servicio.darDeBaja(baja({ bodegaId: id(8) }))).rejects.toThrow(
        'No existe esa bodega o está desactivada.',
      );
      expect(repositorio.escrituras).toHaveLength(0);
    });

    it('responde 404 si el lote no existe en el banco o es de otra referencia', async () => {
      await expect(servicio.darDeBaja(baja({ loteId: id(99) }))).rejects.toThrow(NotFoundException);
      await expect(servicio.ajustar(ajuste({ referenciaId: TERCIO }))).rejects.toThrow(
        'No existe ese lote o no es de esa referencia.',
      );
      expect(repositorio.escrituras).toHaveLength(0);
    });

    it('la carga es el comando validado, con el signo del libro y sin kilos', async () => {
      await servicio.darDeBaja(baja({ comandoId: id(50).toUpperCase(), cantidad: '10.50' }));

      expect(repositorio.escrituras[0]).toEqual({
        tipo: 'baja',
        comandoId: id(50),
        carga: {
          movimientoId: id(101),
          bodegaId: BODEGA,
          referenciaId: KILO,
          loteId: LOTE_DE_KILO,
          cantidad: '-10.5',
          motivo: 'vencido',
        },
        kilos: '-10.5',
      });
    });
  });

  // El reclamo y la carrera entre dos envíos los prueba core
  // (idempotencia.service.spec.ts e idempotencia.integracion.spec.ts).
  describe('idempotencia', () => {
    it('el mismo comando con la misma carga devuelve el movimiento anterior y no resta otra vez', async () => {
      const primera = await servicio.darDeBaja(baja());
      const segunda = await servicio.darDeBaja(baja({ cantidad: '10.000' }));

      expect(segunda).toEqual({ movimiento: primera.movimiento, repetida: true });
      expect(repositorio.saldos.get(LOTE_DE_KILO)).toBe(15);
    });

    it('el mismo comando con otra carga responde 409', async () => {
      await servicio.darDeBaja(baja());

      await expect(servicio.darDeBaja(baja({ motivo: 'roto' }))).rejects.toThrow(ConflictException);
      expect(repositorio.escrituras).toHaveLength(1);
    });

    it('un reenvío después de desactivar la bodega devuelve el movimiento, no 404', async () => {
      const primera = await servicio.darDeBaja(baja());
      bodegas.activas = [];

      const segunda = await servicio.darDeBaja(baja());

      expect(segunda).toEqual({ movimiento: primera.movimiento, repetida: true });
      expect(repositorio.saldos.get(LOTE_DE_KILO)).toBe(15);
    });

    it('con la bodega desactivada, otra carga con el mismo comando responde 409', async () => {
      await servicio.darDeBaja(baja());
      bodegas.activas = [];

      await expect(servicio.darDeBaja(baja({ motivo: 'roto' }))).rejects.toThrow(ConflictException);
    });

    it('un comando nuevo con la bodega desactivada sigue respondiendo 404', async () => {
      bodegas.activas = [];

      await expect(servicio.darDeBaja(baja())).rejects.toThrow(NotFoundException);
      expect(repositorio.escrituras).toHaveLength(0);
    });
  });
});
