import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaveParametro, ParametroVigente, ValorParametro } from '@sigba/shared-types';
import { ParametrosService, ValorParametroInvalido } from './parametros.service.js';
import { ConflictoDeVigencia, ParametrosRepositorio } from './parametros.repositorio.js';
import { ParametroDesconocido } from './parametros.service.js';
import type { ParametroVersion } from './parametros.repositorio.js';
import { decidirEscritura } from './parametros.vigencia.js';

class RepositorioEnMemoria extends ParametrosRepositorio {
  readonly filas: ParametroVersion[] = [];

  async obtenerVigente<K extends ClaveParametro>(
    clave: K,
    fecha: string,
  ): Promise<ParametroVersion<K> | null> {
    return (
      (this.filas.find(
        (fila) =>
          fila.clave === clave &&
          fila.fechaInicio <= fecha &&
          (fila.fechaFin === null || fecha <= fila.fechaFin),
      ) as ParametroVersion<K> | undefined) ?? null
    );
  }

  async listarVigentes(fecha: string) {
    return this.filas.filter(
      (fila) => fila.fechaInicio <= fecha && (fila.fechaFin === null || fecha <= fila.fechaFin),
    );
  }

  async historial(clave: ClaveParametro) {
    return this.filas.filter((fila) => fila.clave === clave).sort((a, b) => a.version - b.version);
  }

  async actualizar<K extends ClaveParametro>(
    clave: K,
    valor: ValorParametro[K],
    fechaInicio: string,
    hoy: string,
  ): Promise<ParametroVersion<K>> {
    const historial = await this.historial(clave);
    const anterior = historial.at(-1);
    const conEsaFecha = historial.find((fila) => fila.fechaInicio === fechaInicio) ?? null;
    const escritura = decidirEscritura(valor, fechaInicio, hoy, {
      conEsaFecha,
      ultima: anterior ?? null,
    });
    if (escritura === 'devolver') return conEsaFecha as ParametroVersion<K>;
    if (escritura === 'corregir') {
      (conEsaFecha as ParametroVersion<K>).valor = valor;
      return conEsaFecha as ParametroVersion<K>;
    }
    if (anterior) anterior.fechaFin = restarUnDia(fechaInicio);
    const nueva: ParametroVersion<K> = {
      id: `fila-${this.filas.length + 1}`,
      clave,
      valor,
      version: (anterior?.version ?? 0) + 1,
      fechaInicio,
      fechaFin: null,
    };
    this.filas.push(nueva);
    return nueva;
  }
}

function restarUnDia(fecha: string): string {
  const anterior = new Date(`${fecha}T00:00:00.000Z`);
  anterior.setUTCDate(anterior.getUTCDate() - 1);
  return anterior.toISOString().slice(0, 10);
}

describe('ParametrosService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: ParametrosService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T15:00:00.000Z'));
    repositorio = new RepositorioEnMemoria();
    servicio = new ParametrosService(repositorio);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('conserva versiones correctas en la fecha anterior y en la fecha nueva', async () => {
    await servicio.actualizar('aporte_solidario_pct', 8);
    await servicio.actualizar('aporte_solidario_pct', 10, '2026-07-11');

    await expect(servicio.obtenerVigente('aporte_solidario_pct', '2026-07-10')).resolves.toEqual({
      valor: 8,
      version: 1,
      fecha_inicio: '2026-07-10',
      fecha_fin: '2026-07-10',
    });
    await expect(servicio.obtenerVigente('aporte_solidario_pct', '2026-07-11')).resolves.toEqual({
      valor: 10,
      version: 2,
      fecha_inicio: '2026-07-11',
      fecha_fin: null,
    });
  });

  it('rechaza 15 % y no guarda nada', async () => {
    const actualizar = vi.spyOn(repositorio, 'actualizar');
    await expect(servicio.actualizar('aporte_solidario_pct', 15)).rejects.toBeInstanceOf(
      ValorParametroInvalido,
    );
    expect(actualizar).not.toHaveBeenCalled();
    expect(repositorio.filas).toHaveLength(0);
  });

  it.each([
    ['aporte_solidario_pct', -1],
    ['aporte_solidario_pct', 10.01],
    ['semaforo_rojo_dias', 1.5],
    ['semaforo_rojo_dias', 0],
    ['semaforo_amarillo_dias', -1],
    ['rangos_etarios', [{ desde: 5, hasta: 4 }]],
    [
      'rangos_etarios',
      [
        { desde: 0, hasta: 5 },
        { desde: 5, hasta: 9 },
      ],
    ],
    [
      'rangos_etarios',
      [
        { desde: 8, hasta: null },
        { desde: 9, hasta: null },
      ],
    ],
    ['rangos_etarios', [{ desde: -1, hasta: null }]],
    ['factor_minorista', 0],
    ['recordatorio_borrador_horas', 2.5],
    ['retencion_dias', -1],
  ] as const)('rechaza el valor inválido para %s', async (clave, valor) => {
    await expect(servicio.actualizar(clave, valor as never)).rejects.toBeInstanceOf(
      ValorParametroInvalido,
    );
    expect(repositorio.filas).toHaveLength(0);
  });

  it('acepta rangos ordenados y no solapados con límite final abierto', async () => {
    const valor = [
      { desde: 0, hasta: 5 },
      { desde: 6, hasta: 12 },
      { desde: 13, hasta: null },
    ];
    await expect(servicio.actualizar('rangos_etarios', valor)).resolves.toMatchObject({ valor });
  });

  it('devuelve null cuando la clave no tiene versión aplicable', async () => {
    await expect(servicio.obtenerVigente('factor_minorista')).resolves.toBeNull();
    await servicio.actualizar('aporte_solidario_pct', 8, '2026-07-11');
    await expect(servicio.obtenerVigente('aporte_solidario_pct', '2026-07-10')).resolves.toBeNull();
    await servicio.actualizar('aporte_solidario_pct', 9, '2026-07-13');
    expect(await servicio.obtenerVigente('aporte_solidario_pct', '2026-07-10')).toBeNull();
  });

  it('lista valores vigentes de todas las claves', async () => {
    await servicio.actualizar('aporte_solidario_pct', 8);
    await servicio.actualizar('factor_minorista', 1.25);
    await expect(servicio.listarVigentes()).resolves.toEqual([
      {
        clave: 'aporte_solidario_pct',
        valor: 8,
        version: 1,
        fecha_inicio: '2026-07-10',
        fecha_fin: null,
      },
      {
        clave: 'factor_minorista',
        valor: 1.25,
        version: 1,
        fecha_inicio: '2026-07-10',
        fecha_fin: null,
      },
    ]);
  });

  it('devuelve el historial en orden de versión', async () => {
    await servicio.actualizar('aporte_solidario_pct', 8);
    await servicio.actualizar('aporte_solidario_pct', 10, '2026-07-11');

    await expect(servicio.historial('aporte_solidario_pct')).resolves.toEqual([
      {
        clave: 'aporte_solidario_pct',
        valor: 8,
        version: 1,
        fecha_inicio: '2026-07-10',
        fecha_fin: '2026-07-10',
      },
      {
        clave: 'aporte_solidario_pct',
        valor: 10,
        version: 2,
        fecha_inicio: '2026-07-11',
        fecha_fin: null,
      },
    ]);
  });

  it('rechaza claves desconocidas y fechas con formato o calendario inválido', async () => {
    await expect(servicio.obtenerVigente('no_existe' as ClaveParametro)).rejects.toBeInstanceOf(
      ParametroDesconocido,
    );
    await expect(servicio.obtenerVigente('aporte_solidario_pct', '2026-02-30')).rejects.toThrow();
    await expect(servicio.actualizar('aporte_solidario_pct', 8, 'ayer')).rejects.toThrow();
  });

  it('rechaza una fecha retroactiva y un segundo cambio con la misma fecha', async () => {
    await servicio.actualizar('aporte_solidario_pct', 8);
    await expect(
      servicio.actualizar('aporte_solidario_pct', 9, '2026-07-09'),
    ).rejects.toBeInstanceOf(ConflictoDeVigencia);
    await expect(
      servicio.actualizar('aporte_solidario_pct', 9, '2026-07-10'),
    ).rejects.toBeInstanceOf(ConflictoDeVigencia);
    expect(repositorio.filas).toHaveLength(1);
  });

  it('devuelve la versión existente cuando llega el mismo valor con la misma fecha', async () => {
    const primera = await servicio.actualizar('aporte_solidario_pct', 8, '2026-07-15');

    await expect(servicio.actualizar('aporte_solidario_pct', 8, '2026-07-15')).resolves.toEqual(
      primera,
    );
    expect(repositorio.filas).toHaveLength(1);
  });

  it('el reintento con fecha explícita sigue devolviendo la versión después de que empieza', async () => {
    const primera = await servicio.actualizar('aporte_solidario_pct', 8, '2026-07-10');
    vi.setSystemTime(new Date('2026-07-12T15:00:00.000Z'));

    await expect(servicio.actualizar('aporte_solidario_pct', 8, '2026-07-10')).resolves.toEqual(
      primera,
    );
    expect(repositorio.filas).toHaveLength(1);
  });

  it('corrige el valor de una versión cuya vigencia aún no empezó', async () => {
    await servicio.actualizar('aporte_solidario_pct', 8);
    await servicio.actualizar('aporte_solidario_pct', 8.5, '2026-07-15');

    await expect(servicio.actualizar('aporte_solidario_pct', 9, '2026-07-15')).resolves.toEqual({
      valor: 9,
      version: 2,
      fecha_inicio: '2026-07-15',
      fecha_fin: null,
    });
    expect(repositorio.filas).toHaveLength(2);
    expect(repositorio.filas[0]).toMatchObject({ valor: 8, fechaFin: '2026-07-14' });
  });

  it('no edita una versión vigente ni pasada: responde 409', async () => {
    await servicio.actualizar('aporte_solidario_pct', 8);
    await servicio.actualizar('aporte_solidario_pct', 9, '2026-07-15');
    vi.setSystemTime(new Date('2026-07-16T15:00:00.000Z'));

    await expect(
      servicio.actualizar('aporte_solidario_pct', 7, '2026-07-10'),
    ).rejects.toBeInstanceOf(ConflictoDeVigencia);
    await expect(
      servicio.actualizar('aporte_solidario_pct', 7, '2026-07-15'),
    ).rejects.toBeInstanceOf(ConflictoDeVigencia);
    expect(repositorio.filas.map((fila) => fila.valor)).toEqual([8, 9]);
  });

  it('rechaza fechas anteriores a hoy aunque todavía no exista historial', async () => {
    await expect(
      servicio.actualizar('aporte_solidario_pct', 8, '2026-07-09'),
    ).rejects.toBeInstanceOf(ConflictoDeVigencia);
    expect(repositorio.filas).toHaveLength(0);
  });

  it('expone el tipo de lectura del contrato compartido', async () => {
    const resultado: ParametroVigente<'aporte_solidario_pct'> | null =
      await servicio.obtenerVigente('aporte_solidario_pct');
    expect(resultado).toBeNull();
  });
});
