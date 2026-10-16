import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/core/auditoria/audit.service.js';
import { PrismaService, runWithTenantContext } from '../src/core/index.js';
import { RED_ABACO } from '../src/modules/plataforma/repositories/bancos.prisma.repositorio.js';
import { BodegasPrismaRepositorio } from '../src/modules/plataforma/repositories/bodegas.prisma.repositorio.js';
import { BodegaConStock } from '../src/modules/plataforma/services/bodega.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Una bodega con stock no se desactiva (SBA-76).
 *
 * El repositorio corre con el rol sin privilegios, como la API; el trigger de
 * la base es quien lo rechaza. El saldo nace de movimientos del libro que
 * siembra el administrador.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('DATABASE_URL no está definida en CI.');
}

const banco = 'b7600000-0000-4000-8000-00000000000a';
const usuario = 'b7600000-0000-4000-8000-000000000101';
const ACTOR = 'prueba-sba-76';

describe.skipIf(!URL_ADMIN)('Bodega con stock contra PostgreSQL (SBA-76)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let bodegas: BodegasPrismaRepositorio;
  let lote: { id: string; referenciaId: string };

  const enBanco = <R>(bancoId: string, fn: () => Promise<R>) =>
    runWithTenantContext({ bancoId, usuarioId: usuario }, fn) as Promise<R>;

  async function limpiarInventario(): Promise<void> {
    // El libro, el lote y la recepción rechazan DELETE con un trigger; el
    // administrador lo apaga solo en esta transacción.
    const enBancos = `banco_id = '${banco}'`;
    await admin.$transaction([
      admin.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      ...[
        'saldo',
        'movimiento',
        'lote',
        'recepcion',
        'referencia',
        'producto',
        'categoria',
        'donante',
      ].map((tabla) =>
        admin.$executeRawUnsafe(`DELETE FROM inventario.${tabla} WHERE ${enBancos}`),
      ),
      admin.$executeRawUnsafe(`DELETE FROM plataforma.bodega WHERE ${enBancos}`),
    ]);
  }

  async function limpiar(): Promise<void> {
    await limpiarInventario();
    await admin.$executeRaw`DELETE FROM plataforma.usuario WHERE id = ${usuario}::uuid`;
    await admin.$executeRaw`DELETE FROM plataforma.banco WHERE id = ${banco}::uuid`;
  }

  /** Una bodega activa del banco con un lote de cinco unidades de 1 kg. */
  async function bodegaConLote(): Promise<string> {
    const bodegaId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodegaId}::uuid, ${banco}::uuid, ${`Bodega ${bodegaId.slice(0, 8)}`}, true)`;
    await entrada(bodegaId, 5);
    return bodegaId;
  }

  function entrada(bodegaId: string, cantidad: number) {
    return admin.$executeRaw`
      INSERT INTO inventario.movimiento
        (id, banco_id, comando_id, tipo, referencia_id, lote_id, bodega_id, cantidad, kilos, creado_por)
      VALUES (gen_random_uuid(), ${banco}::uuid, gen_random_uuid(),
              ${cantidad > 0 ? 'entrada' : 'salida'}::inventario.tipo_movimiento,
              ${lote.referenciaId}::uuid, ${lote.id}::uuid, ${bodegaId}::uuid,
              ${cantidad}, ${cantidad}, ${ACTOR})`;
  }

  function desactivar(bodegaId: string) {
    return enBanco(banco, () => bodegas.actualizar(bodegaId, { activa: false }));
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    bodegas = new BodegasPrismaRepositorio(app as PrismaService, new AuditService());

    await limpiar();
    await admin.$executeRaw`
      INSERT INTO plataforma.banco (id, red_id, nombre, codigo)
      VALUES (${banco}::uuid, ${RED_ABACO}::uuid, 'Banco con stock', 'SBA76A')`;
    await admin.$executeRaw`
      INSERT INTO plataforma.usuario (id, emisor, auth0_sub, email, nombre)
      VALUES (${usuario}::uuid, 'https://prueba-sba-76.sigba/', ${`prueba|${usuario}`},
              ${`prueba+${usuario}@example.invalid`}, 'Admin SBA-76')`;
  });

  beforeEach(async () => {
    await limpiarInventario();
    // Un solo lote por prueba, del banco, con su catálogo y su recepción.
    const ids = {
      categoria: randomUUID(),
      producto: randomUUID(),
      referencia: randomUUID(),
      donante: randomUUID(),
      recepcion: randomUUID(),
      lote: randomUUID(),
    };
    await admin.$executeRaw`
      INSERT INTO inventario.categoria (id, banco_id, codigo, nombre)
      VALUES (${ids.categoria}::uuid, ${banco}::uuid, 'C801', 'Arroz')`;
    await admin.$executeRaw`
      INSERT INTO inventario.producto (id, banco_id, categoria_id, nombre)
      VALUES (${ids.producto}::uuid, ${banco}::uuid, ${ids.categoria}::uuid, 'Arroz')`;
    await admin.$executeRaw`
      INSERT INTO inventario.referencia (id, banco_id, producto_id, presentacion, equivalencia_kg)
      VALUES (${ids.referencia}::uuid, ${banco}::uuid, ${ids.producto}::uuid, '1 kg', 1)`;
    await admin.$executeRaw`
      INSERT INTO inventario.donante (id, banco_id, nombre, tipo)
      VALUES (${ids.donante}::uuid, ${banco}::uuid, 'Supermercado', 'empresa')`;
    await admin.$executeRaw`
      INSERT INTO inventario.recepcion (id, banco_id, donante_id, origen, bodega_id, creado_por)
      VALUES (${ids.recepcion}::uuid, ${banco}::uuid, ${ids.donante}::uuid, 'propia',
              ${randomUUID()}::uuid, ${ACTOR})`;
    await admin.$executeRaw`
      INSERT INTO inventario.lote (id, banco_id, recepcion_id, referencia_id, equivalencia_kg, creado_por)
      VALUES (${ids.lote}::uuid, ${banco}::uuid, ${ids.recepcion}::uuid, ${ids.referencia}::uuid, 1, ${ACTOR})`;
    lote = { id: ids.lote, referenciaId: ids.referencia };
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('con saldo no se desactiva y sigue activa', async () => {
    const bodegaId = await bodegaConLote();

    await expect(desactivar(bodegaId)).rejects.toThrow(BodegaConStock);
    const fila = await admin.bodega.findUniqueOrThrow({ where: { id: bodegaId } });
    expect(fila.activa).toBe(true);
  });

  it('con todos sus lotes en cero se desactiva', async () => {
    const bodegaId = await bodegaConLote();
    await entrada(bodegaId, -5);

    const bodega = await desactivar(bodegaId);

    expect(bodega?.activa).toBe(false);
  });

  it('sin lotes se desactiva', async () => {
    const bodegaId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO plataforma.bodega (id, banco_id, nombre, activa)
      VALUES (${bodegaId}::uuid, ${banco}::uuid, 'Bodega vacía', true)`;

    expect((await desactivar(bodegaId))?.activa).toBe(false);
  });

  it('editar el nombre de una bodega con stock sí se puede', async () => {
    const bodegaId = await bodegaConLote();

    const bodega = await enBanco(banco, () =>
      bodegas.actualizar(bodegaId, { nombre: 'Bodega renombrada' }),
    );

    expect(bodega).toMatchObject({ nombre: 'Bodega renombrada', activa: true });
  });
});
