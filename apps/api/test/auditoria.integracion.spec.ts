import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditService,
  executeTransactionWithTenant,
  runWithTenantContext,
} from '../src/core/index.js';
import { type PrismaService } from '../src/core/database/index.js';
import { DonantesPrismaRepositorio } from '../src/modules/inventario/repositories/donantes.prisma.repositorio.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('Falta DATABASE_URL en CI para probar auditoría y RLS.');
}

describe.skipIf(!URL_ADMIN)('Auditoría contra PostgreSQL con el rol de la API', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let donantes: DonantesPrismaRepositorio;

  const bancoA = 'a1111111-1111-4111-8111-111111111111';
  const bancoB = 'b2222222-2222-4222-8222-222222222222';
  const etiqueta = 'auditoria-integracion';
  const auditoria = new AuditService();

  function conBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, usuarioId: etiqueta }, fn) as Promise<R>;
  }

  async function limpiar(): Promise<void> {
    await admin.$executeRaw`DELETE FROM core.auditoria WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
    await admin.$executeRaw`DELETE FROM inventario.donante WHERE banco_id IN (${bancoA}::uuid, ${bancoB}::uuid)`;
  }

  async function registrarEnBanco(bancoId: string, entidadId: string): Promise<void> {
    await conBanco(bancoId, () =>
      executeTransactionWithTenant(
        app,
        (tx) =>
          auditoria.registrar(tx, {
            accion: 'leer',
            entidad: 'donante',
            entidadId,
            finalidad: 'prueba',
          }),
        { bancoId, usuarioId: etiqueta },
      ),
    );
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    donantes = new DonantesPrismaRepositorio(app as PrismaService, auditoria);
  });

  beforeEach(limpiar);

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('el adaptador registra banco, actor, acción, entidad e id de la fila', async () => {
    const fila = await conBanco(bancoA, () =>
      donantes.crear({ nombre: 'Donante de auditoría', tipo: 'empresa', contacto: null }),
    );
    const [registro] = await admin.$queryRaw<
      {
        banco_id: string;
        actor_tipo: string;
        actor_etiqueta: string;
        accion: string;
        entidad: string;
        entidad_id: string;
      }[]
    >`SELECT banco_id::text, actor_tipo, actor_etiqueta, accion, entidad, entidad_id
      FROM core.auditoria WHERE entidad_id = ${fila.id}`;

    expect(registro).toEqual({
      banco_id: bancoA,
      actor_tipo: 'sistema',
      actor_etiqueta: etiqueta,
      accion: 'crear',
      entidad: 'donante',
      entidad_id: fila.id,
    });
  });

  it('revierte la fila de negocio y su auditoría juntas', async () => {
    const nombre = 'Donante revertido';
    const entidadId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    await expect(
      conBanco(bancoA, () =>
        executeTransactionWithTenant(
          app,
          async (tx) => {
            await tx.donante.create({
              data: {
                bancoId: bancoA,
                nombre,
                tipo: 'empresa',
                creadoPor: etiqueta,
                actualizadoPor: etiqueta,
              },
            });
            await auditoria.registrar(tx, {
              accion: 'crear',
              entidad: 'donante',
              entidadId,
            });
            throw new Error('rollback de prueba');
          },
          { bancoId: bancoA, usuarioId: etiqueta },
        ),
      ),
    ).rejects.toThrow('rollback de prueba');

    const [donantesRevertidos] = await admin.$queryRaw<{ cantidad: bigint }[]>`
      SELECT count(*) AS cantidad FROM inventario.donante WHERE nombre = ${nombre}`;
    const [auditoriasRevertidas] = await admin.$queryRaw<{ cantidad: bigint }[]>`
      SELECT count(*) AS cantidad FROM core.auditoria WHERE entidad_id = ${entidadId}`;
    expect(Number(donantesRevertidos?.cantidad)).toBe(0);
    expect(Number(auditoriasRevertidas?.cantidad)).toBe(0);
  });

  it('deniega DML directo del rol de API y conserva lectura y ejecución autorizadas', async () => {
    const [permisos] = await app.$queryRaw<
      {
        puede_leer: boolean;
        puede_insertar: boolean;
        puede_actualizar: boolean;
        puede_eliminar: boolean;
        puede_ejecutar: boolean;
      }[]
    >`SELECT
      has_table_privilege(current_user, 'core.auditoria', 'SELECT') AS puede_leer,
      has_table_privilege(current_user, 'core.auditoria', 'INSERT') AS puede_insertar,
      has_table_privilege(current_user, 'core.auditoria', 'UPDATE') AS puede_actualizar,
      has_table_privilege(current_user, 'core.auditoria', 'DELETE') AS puede_eliminar,
      has_function_privilege(current_user, 'core.registrar_auditoria(text,text,text,text,jsonb)', 'EXECUTE') AS puede_ejecutar`;

    expect(permisos).toEqual({
      puede_leer: true,
      puede_insertar: false,
      puede_actualizar: false,
      puede_eliminar: false,
      puede_ejecutar: true,
    });

    await expect(
      conBanco(bancoA, () =>
        executeTransactionWithTenant(
          app,
          (tx) =>
            tx.$executeRaw`INSERT INTO core.auditoria (banco_id, actor_tipo, actor_etiqueta, accion, entidad, entidad_id)
              VALUES (${bancoA}::uuid, 'sistema', ${etiqueta}, 'crear', 'donante', 'direct-insert')`,
          { bancoId: bancoA, usuarioId: etiqueta },
        ),
      ),
    ).rejects.toThrow();
    await expect(
      conBanco(bancoA, () =>
        executeTransactionWithTenant(
          app,
          (tx) => tx.$executeRaw`UPDATE core.auditoria SET resultado = 'actualizado'`,
          { bancoId: bancoA, usuarioId: etiqueta },
        ),
      ),
    ).rejects.toThrow();
    await expect(
      conBanco(bancoA, () =>
        executeTransactionWithTenant(app, (tx) => tx.$executeRaw`DELETE FROM core.auditoria`, {
          bancoId: bancoA,
          usuarioId: etiqueta,
        }),
      ),
    ).rejects.toThrow();
  });

  it('aísla la lectura por banco y toma el banco del contexto, no de argumentos', async () => {
    const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await registrarEnBanco(bancoA, idA);
    await registrarEnBanco(bancoB, idB);

    const filas = await executeTransactionWithTenant<{ banco_id: string; entidad_id: string }[]>(
      app,
      (tx) =>
        tx.$queryRaw`SELECT banco_id::text, entidad_id FROM core.auditoria WHERE entidad = 'donante'`,
      { bancoId: bancoA, usuarioId: etiqueta },
    );
    expect(filas).toEqual([{ banco_id: bancoA, entidad_id: idA }]);

    const [asignada] = await admin.$queryRaw<{ banco_id: string }[]>`
      SELECT banco_id::text FROM core.auditoria WHERE entidad_id = ${idA}`;
    expect(asignada?.banco_id).toBe(bancoA);

    const idContexto = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await conBanco(bancoA, () =>
      executeTransactionWithTenant(
        app,
        (tx) =>
          tx.$queryRaw`SELECT core.registrar_auditoria(
            'leer', 'donante', ${idContexto}, 'prueba', NULL
          )`,
        { bancoId: bancoA, usuarioId: etiqueta },
      ),
    );
    const [registroContexto] = await admin.$queryRaw<
      { banco_id: string; entidad_id: string }[]
    >`SELECT banco_id::text, entidad_id FROM core.auditoria WHERE entidad_id = ${idContexto}`;
    expect(registroContexto).toEqual({ banco_id: bancoA, entidad_id: idContexto });

    await expect(
      conBanco(bancoA, () =>
        executeTransactionWithTenant(
          app,
          (tx) => tx.$queryRaw`SELECT core.registrar_auditoria(
            'leer', 'donante', 'intento', NULL, NULL
          )`,
          { bancoId: bancoA, usuarioId: etiqueta },
        ),
      ),
    ).resolves.toBeDefined();
  });

  it('la función falla si la transacción no fija banco y actor', async () => {
    await expect(
      app.$queryRaw`SELECT core.registrar_auditoria('leer', 'donante', 'sin-contexto', NULL, NULL)`,
    ).rejects.toThrow(/contexto/);
  });

  it('convierte la etiqueta de un comando en actor del sistema', async () => {
    await registrarEnBanco(bancoA, 'etiqueta-sistema');
    const [registro] = await admin.$queryRaw<
      { actor_tipo: string; actor_etiqueta: string; actor_id: string | null }[]
    >`SELECT actor_tipo, actor_etiqueta, actor_id::text
      FROM core.auditoria WHERE entidad_id = 'etiqueta-sistema'`;
    expect(registro).toEqual({
      actor_tipo: 'sistema',
      actor_etiqueta: etiqueta,
      actor_id: null,
    });
  });
});
