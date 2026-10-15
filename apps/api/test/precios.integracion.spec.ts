import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  IdempotenciaService,
  type PrismaService,
  runWithTenantContext,
} from '../src/core/index.js';
import { PreciosPrismaRepositorio } from '../src/modules/inventario/repositories/precios.prisma.repositorio.js';
import { ReferenciasPrismaRepositorio } from '../src/modules/inventario/repositories/referencias.prisma.repositorio.js';
import type { ProponerPrecio } from '../src/modules/inventario/services/precio.js';
import { PreciosService } from '../src/modules/inventario/services/precios.service.js';
import { ReferenciasService } from '../src/modules/inventario/services/referencias.service.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Maestro de precios contra PostgreSQL (SBA-39, ADR-07, ADR-08, ADR-13).
 *
 * Prueba el servicio con el adaptador de Prisma, conectado como `sigba_app`:
 * los tres criterios del ticket, el historial que no borra, el cierre del
 * aprobado anterior, la exclusión de vigencias cruzadas, el trigger que deja
 * cambiar solo la aprobación y el cierre, la idempotencia por comando y que
 * RLS deje a cada banco con sus precios. Las reglas de validación las cubre
 * `precios.service.spec.ts` sin base de datos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const ACTOR = 'coordinacion-prueba';

describe.skipIf(!URL_ADMIN)('Maestro de precios contra PostgreSQL (SBA-39)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let servicio: PreciosService;
  let referencias: ReferenciasService;

  const bancoA = 'aaaaaaaa-3939-4939-8939-aaaaaaaaaaaa';
  const bancoB = 'bbbbbbbb-3939-4939-8939-bbbbbbbbbbbb';
  const red = 'ffffffff-3939-4939-8939-ffffffffffff';

  let siguiente = 0;
  /** Un UUIDv7 nuevo en cada llamada, como los que genera el cliente. */
  function uuidv7(): string {
    siguiente += 1;
    return `01920000-0000-7000-8039-${String(siguiente).padStart(12, '0')}`;
  }

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, actor: ACTOR }, fn) as Promise<R>;
  }

  /** SQL crudo como sigba_app, con el banco fijado en la transacción. */
  function comoApp(bancoId: string, sql: string) {
    return app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoId}, true)`;
      return tx.$executeRawUnsafe(sql);
    });
  }

  async function limpiar(): Promise<void> {
    // precio y comando_procesado rechazan DELETE con un trigger; el
    // administrador lo apaga para esta transacción y nada más.
    const enBancos = `banco_id IN ('${bancoA}', '${bancoB}')`;
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      ...['precio', 'referencia', 'producto', 'categoria'].map((tabla) =>
        admin.$executeRawUnsafe(`DELETE FROM inventario.${tabla} WHERE ${enBancos}`),
      ),
      admin.$executeRawUnsafe(`DELETE FROM core.comando_procesado WHERE ${enBancos}`),
    ]);
  }

  async function borrarBancos(): Promise<void> {
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM plataforma.red WHERE id = ${red}::uuid`;
  }

  /** Una referencia del banco que se le pida: arroz de 500 g. */
  async function referenciaDe(bancoId: string): Promise<string> {
    return enBanco(bancoId, async () => {
      const categoria = await referencias.crearCategoria({ codigo: 'C801', nombre: 'Arroz' });
      const producto = await referencias.crearProducto({
        categoriaId: categoria.id,
        nombre: 'Arroz',
      });
      const referencia = await referencias.crearReferencia({
        productoId: producto.id,
        presentacion: '500 g',
        equivalenciaKg: '0.5',
      });
      return referencia.id;
    });
  }

  function propuesta(referenciaId: string, cambios: Partial<ProponerPrecio> = {}): ProponerPrecio {
    return {
      comandoId: uuidv7(),
      referenciaId,
      valor: '2800',
      piso: '2500',
      techo: '3200',
      fuente: 'sipsa',
      evidencia: 'SIPSA-P Pereira, semana 41',
      vigenteDesde: '2026-10-01',
      vigenteHasta: '2026-10-31',
      ...cambios,
    };
  }

  async function proponer(bancoId: string, comando: ProponerPrecio): Promise<string> {
    return (await enBanco(bancoId, () => servicio.proponer(comando))).precio.id;
  }

  async function aprobar(bancoId: string, precioId: string, motivo?: string) {
    return enBanco(bancoId, () =>
      servicio.aprobar({ comandoId: uuidv7(), precioId, motivoFueraDeBanda: motivo ?? null }),
    );
  }

  async function aprobado(referenciaId: string, cambios: Partial<ProponerPrecio> = {}) {
    const id = await proponer(bancoA, propuesta(referenciaId, cambios));
    await aprobar(bancoA, id);
    return id;
  }

  async function auditoriaDe(entidadId: string) {
    return admin.$queryRaw<{ banco_id: string; actor_etiqueta: string; accion: string }[]>`
      SELECT banco_id::text, actor_etiqueta, accion
      FROM core.auditoria WHERE entidad = 'precio' AND entidad_id = ${entidadId}
      ORDER BY ocurrido_en`;
  }

  async function filasDe(bancoId: string): Promise<number> {
    const [fila] = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM inventario.precio WHERE banco_id = ${bancoId}::uuid`;
    return Number(fila?.n ?? 0);
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    await limpiar();
    await borrarBancos();
    await admin.$executeRaw`INSERT INTO plataforma.red (id, nombre) VALUES (${red}::uuid, 'Red de precios')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${bancoA}::uuid, ${red}::uuid, 'Banco A', 'PRE-A'),
             (${bancoB}::uuid, ${red}::uuid, 'Banco B', 'PRE-B')`;
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    const prisma = app as PrismaService;
    const auditoria = new AuditService();
    servicio = new PreciosService(
      new PreciosPrismaRepositorio(prisma, new IdempotenciaService(), auditoria),
    );
    referencias = new ReferenciasService(
      new ReferenciasPrismaRepositorio(prisma, auditoria, new IdempotenciaService()),
    );
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await borrarBancos();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('la tabla tiene RLS activo y forzado', async () => {
    const [tabla] = await admin.$queryRaw<{ rls: boolean; forzado: boolean }[]>`
      SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'inventario' AND c.relname = 'precio'`;

    expect(tabla).toEqual({ rls: true, forzado: true });
  });

  it('propone, aprueba y audita cada paso con el actor y el banco', async () => {
    const referenciaId = await referenciaDe(bancoA);

    const { precio, repetida } = await enBanco(bancoA, () =>
      servicio.proponer(propuesta(referenciaId, { valor: '2800.50', vigenteHasta: null })),
    );
    const { precio: aprobadoYa } = await aprobar(bancoA, precio.id);

    expect(repetida).toBe(false);
    expect(precio).toMatchObject({
      valor: '2800.5',
      estado: 'propuesto',
      vigenteDesde: '2026-10-01',
      vigenteHasta: '2026-10-30',
      creadoPor: ACTOR,
    });
    expect(aprobadoYa).toMatchObject({ aprobadoPor: ACTOR, motivoFueraDeBanda: null });
    expect(await auditoriaDe(precio.id)).toEqual([
      { banco_id: bancoA, actor_etiqueta: ACTOR, accion: 'crear' },
      { banco_id: bancoA, actor_etiqueta: ACTOR, accion: 'actualizar' },
    ]);
  });

  describe('criterios de SBA-39', () => {
    it('1. un propuesto sin aprobar deja la valoración pendiente y no usa su valor', async () => {
      const referenciaId = await referenciaDe(bancoA);
      await proponer(bancoA, propuesta(referenciaId));

      expect(await enBanco(bancoA, () => servicio.vigente(referenciaId, '2026-10-15'))).toEqual({
        referenciaId,
        fecha: '2026-10-15',
        valoracion: 'pendiente',
        precio: null,
      });
    });

    it('2. fuera de la banda, aprobar exige motivo; con motivo queda aprobado', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const id = await proponer(bancoA, propuesta(referenciaId, { valor: '4100' }));

      await expect(aprobar(bancoA, id)).rejects.toThrow(
        'El valor 4100 está fuera de la banda de 2500 a 3200. Para aprobarlo escribe el motivo.',
      );
      const { precio } = await aprobar(bancoA, id, 'Alza por el paro camionero');

      expect(precio).toMatchObject({
        estado: 'aprobado',
        motivoFueraDeBanda: 'Alza por el paro camionero',
      });
    });

    it('2. la base rechaza aprobar fuera de la banda sin motivo aunque se salte el servicio', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const id = await proponer(bancoA, propuesta(referenciaId, { valor: '4100' }));

      await expect(
        admin.$executeRawUnsafe(
          `UPDATE inventario.precio
           SET estado = 'aprobado', aprobado_por = 'x', aprobado_en = now()
           WHERE id = '${id}'`,
        ),
      ).rejects.toThrow(/precio_motivo_fuera_de_banda/);
    });

    it('3. un aprobado vencido no se usa ni se sustituye por cero', async () => {
      const referenciaId = await referenciaDe(bancoA);
      await aprobado(referenciaId, { vigenteDesde: '2020-01-01', vigenteHasta: '2020-01-31' });

      const valoracion = await enBanco(bancoA, () => servicio.vigente(referenciaId, '2020-02-01'));
      const historial = await enBanco(bancoA, () => servicio.historial(referenciaId));

      expect(valoracion).toMatchObject({ valoracion: 'pendiente', precio: null });
      expect(historial.map((p) => p.estado)).toEqual(['vencido']);
    });
  });

  describe('historial y vigencias', () => {
    it('aprobar uno nuevo cierra el anterior el día antes y no lo borra', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const anterior = await aprobado(referenciaId, {
        vigenteDesde: '2099-01-01',
        vigenteHasta: null,
      });
      const nuevo = await aprobado(referenciaId, {
        valor: '3000',
        vigenteDesde: '2099-01-16',
        vigenteHasta: '2099-02-15',
      });

      const historial = await enBanco(bancoA, () => servicio.historial(referenciaId));

      expect(historial.map((p) => [p.id, p.estado, p.vigenteDesde, p.vigenteHasta])).toEqual([
        [nuevo, 'aprobado', '2099-01-16', '2099-02-15'],
        [anterior, 'aprobado', '2099-01-01', '2099-01-15'],
      ]);
      // Propuesto, aprobado y cerrado.
      expect((await auditoriaDe(anterior)).map((a) => a.accion)).toEqual([
        'crear',
        'actualizar',
        'actualizar',
      ]);

      const enero15 = await enBanco(bancoA, () => servicio.vigente(referenciaId, '2099-01-15'));
      const enero16 = await enBanco(bancoA, () => servicio.vigente(referenciaId, '2099-01-16'));
      expect(enero15.precio?.id).toBe(anterior);
      expect(enero16.precio).toMatchObject({ id: nuevo, valor: '3000' });
    });

    it('aprobar uno que empieza antes de un aprobado posterior responde 409 y no escribe', async () => {
      const referenciaId = await referenciaDe(bancoA);
      await aprobado(referenciaId, { vigenteDesde: '2099-03-01', vigenteHasta: '2099-03-31' });
      const antes = await proponer(
        bancoA,
        propuesta(referenciaId, { vigenteDesde: '2099-02-15', vigenteHasta: '2099-03-15' }),
      );

      await expect(aprobar(bancoA, antes)).rejects.toThrow(
        'La vigencia se cruza con otro precio aprobado de la referencia que empieza el mismo día o después.',
      );
      const historial = await enBanco(bancoA, () => servicio.historial(referenciaId));
      expect(historial.map((p) => p.estado).sort()).toEqual(['aprobado', 'propuesto']);
    });

    it('la base rechaza dos aprobados con vigencias cruzadas', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const insertar = (desde: string, hasta: string) =>
        admin.$executeRawUnsafe(
          `INSERT INTO inventario.precio
           (banco_id, referencia_id, valor, piso, techo, fuente, evidencia, vigente_desde,
            vigente_hasta, estado, aprobado_por, aprobado_en, creado_por, actualizado_por)
           VALUES ('${bancoA}', '${referenciaId}', 2800, 2500, 3200, 'manual', 'prueba',
            '${desde}', '${hasta}', 'aprobado', 'x', now(), 'x', 'x')`,
        );

      await insertar('2099-01-01', '2099-01-31');
      await expect(insertar('2099-01-31', '2099-02-28')).rejects.toThrow(
        /precio_aprobados_sin_cruce/,
      );
      await expect(insertar('2099-02-01', '2099-02-28')).resolves.toBe(1);
    });

    it('dos propuestos pueden cruzarse: la exclusión solo cuenta aprobados', async () => {
      const referenciaId = await referenciaDe(bancoA);
      await proponer(bancoA, propuesta(referenciaId));
      await proponer(bancoA, propuesta(referenciaId, { valor: '2900' }));

      expect(await filasDe(bancoA)).toBe(2);
    });
  });

  describe('lo que cambia de un precio (ADR-08)', () => {
    it('el valor, la banda y la evidencia de un aprobado no cambian, ni para el administrador', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const id = await aprobado(referenciaId);

      for (const cambio of [
        'valor = 1',
        'techo = 9999',
        "evidencia = 'otra'",
        "fuente = 'manual'",
      ]) {
        await expect(
          admin.$executeRawUnsafe(`UPDATE inventario.precio SET ${cambio} WHERE id = '${id}'`),
          cambio,
        ).rejects.toThrow(/no admite cambiar valor/);
      }
      await expect(
        admin.$executeRawUnsafe(`DELETE FROM inventario.precio WHERE id = '${id}'`),
      ).rejects.toThrow(/solo admite aprobar un propuesto o acortar la vigencia/);
    });

    it('la vigencia de un aprobado solo se acorta, y un aprobado no vuelve a propuesto', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const id = await aprobado(referenciaId, { vigenteHasta: '2026-10-31' });
      const actualizar = (set: string) =>
        admin.$executeRawUnsafe(`UPDATE inventario.precio SET ${set} WHERE id = '${id}'`);

      await expect(actualizar(`vigente_hasta = '2026-11-30'`)).rejects.toThrow(/acortar/);
      await expect(actualizar(`vigente_hasta = NULL`)).rejects.toThrow(/acortar/);
      await expect(
        actualizar(`estado = 'propuesto', aprobado_por = NULL, aprobado_en = NULL`),
      ).rejects.toThrow(/acortar/);
      await expect(actualizar(`vigente_hasta = '2026-10-20'`)).resolves.toBe(1);
    });

    it('sigba_app no tiene DELETE sobre precio', async () => {
      const referenciaId = await referenciaDe(bancoA);
      await proponer(bancoA, propuesta(referenciaId));

      await expect(comoApp(bancoA, `DELETE FROM inventario.precio`)).rejects.toThrow(
        /permission denied/,
      );
      expect(await filasDe(bancoA)).toBe(1);
    });
  });

  describe('idempotencia', () => {
    it('proponer dos veces con la misma carga devuelve lo mismo; otra carga responde 409', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const comando = propuesta(referenciaId);

      const primera = await enBanco(bancoA, () => servicio.proponer(comando));
      const segunda = await enBanco(bancoA, () => servicio.proponer(comando));

      expect(segunda.repetida).toBe(true);
      expect(segunda.precio).toEqual(primera.precio);
      await expect(
        enBanco(bancoA, () => servicio.proponer({ ...comando, valor: '2900' })),
      ).rejects.toThrow('Este comando ya se procesó con otra carga.');
      expect(await filasDe(bancoA)).toBe(1);
      expect(await auditoriaDe(primera.precio.id)).toHaveLength(1);
    });

    it('aprobar dos veces con el mismo comando devuelve lo mismo; con otro, 409', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const id = await proponer(bancoA, propuesta(referenciaId));
      const comando = { comandoId: uuidv7(), precioId: id };

      const primera = await enBanco(bancoA, () => servicio.aprobar(comando));
      const segunda = await enBanco(bancoA, () => servicio.aprobar(comando));

      expect(segunda).toEqual({ ...primera, repetida: true });
      await expect(aprobar(bancoA, id)).rejects.toThrow('Ese precio ya está aprobado.');
      await expect(
        enBanco(bancoA, () => servicio.aprobar({ ...comando, motivoFueraDeBanda: 'otro' })),
      ).rejects.toThrow('Este comando ya se procesó con otra carga.');
      expect(await auditoriaDe(id)).toHaveLength(2);
    });
  });

  describe('aislamiento entre bancos (ADR-07)', () => {
    it('el banco B no ve el historial ni el precio vigente del banco A', async () => {
      const referenciaId = await referenciaDe(bancoA);
      await aprobado(referenciaId);

      expect(await enBanco(bancoB, () => servicio.historial(referenciaId))).toEqual([]);
      expect(
        await enBanco(bancoB, () => servicio.vigente(referenciaId, '2026-10-15')),
      ).toMatchObject({ valoracion: 'pendiente', precio: null });
      const visibles = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoB}, true)`;
        return tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM inventario.precio`;
      });
      expect(Number(visibles[0]?.n)).toBe(0);
    });

    it('el banco B no aprueba un precio del banco A ni propone con su referencia', async () => {
      const referenciaId = await referenciaDe(bancoA);
      const id = await proponer(bancoA, propuesta(referenciaId));

      await expect(aprobar(bancoB, id)).rejects.toThrow('No existe ese precio.');
      await expect(proponer(bancoB, propuesta(referenciaId))).rejects.toThrow(
        'No existe esa referencia.',
      );
      const [fila] = await admin.$queryRaw<{ estado: string }[]>`
        SELECT estado::text FROM inventario.precio WHERE id = ${id}::uuid`;
      expect(fila?.estado).toBe('propuesto');
      expect(await filasDe(bancoB)).toBe(0);
    });

    it('con el contexto del banco B, un INSERT con el banco_id de A falla por la política', async () => {
      const referenciaId = await referenciaDe(bancoA);

      await expect(
        comoApp(
          bancoB,
          `INSERT INTO inventario.precio
           (banco_id, referencia_id, valor, piso, techo, fuente, evidencia, vigente_desde,
            creado_por, actualizado_por)
           VALUES ('${bancoA}', '${referenciaId}', 2800, 2500, 3200, 'manual', 'x',
            '2026-10-01', 'intruso', 'intruso')`,
        ),
      ).rejects.toThrow(/row-level security/);
      expect(await filasDe(bancoA)).toBe(0);
    });

    it('cada banco tiene sus propias claves de comando', async () => {
      const deA = await referenciaDe(bancoA);
      const deB = await referenciaDe(bancoB);
      const comandoId = randomUUID();

      await proponer(bancoA, propuesta(deA, { comandoId }));
      const enB = await enBanco(bancoB, () =>
        servicio.proponer(propuesta(deB, { comandoId, valor: '3000' })),
      );

      expect(enB.repetida).toBe(false);
      expect(await filasDe(bancoB)).toBe(1);
    });
  });
});
