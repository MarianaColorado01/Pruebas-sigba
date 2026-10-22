import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import {
  executeTransactionWithTenant,
  getTenantContext,
  runWithTenantContext,
  type TenantContext,
} from '../src/core/database/index.js';

/**
 * Lo que se puede comprobar sin base de datos: que el contexto viaja y que la
 * transacción lo fija de forma segura.
 *
 * El aislamiento en sí no se demuestra aquí. Eso lo hace
 * `aislamiento.integracion.spec.ts` contra PostgreSQL, porque una política RLS
 * solo la aplica el motor: simularla en JavaScript comprueba el JavaScript
 * (RNF-01, ADR-05, ADR-07).
 */

const aqui = resolve(fileURLToPath(new URL('.', import.meta.url)));

describe('Contrato del esquema y la migración (ADR-05, ADR-07)', () => {
  const schema = readFileSync(resolve(aqui, '../prisma/schema.prisma'), 'utf8');
  const carpetaMigraciones = resolve(aqui, '../prisma/migrations');
  // Todas juntas: una tabla nueva en una migración posterior también tiene que
  // traer su RLS.
  const migracion = readdirSync(carpetaMigraciones, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) =>
      readFileSync(resolve(carpetaMigraciones, entrada.name, 'migration.sql'), 'utf8'),
    )
    .join('\n');

  it('declara los cinco schemas del monolito modular', () => {
    expect(schema).toContain(
      'schemas  = ["core", "plataforma", "inventario", "beneficiarios", "analitica"]',
    );
  });

  it('ninguna tabla con banco_id queda sin ENABLE y FORCE ROW LEVEL SECURITY', () => {
    const conBancoId = [
      ...migracion.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"(\w+)"\."(\w+)"[^;]*?"banco_id"/gs),
    ].map((m) => `"${m[1]}"."${m[2]}"`);

    expect(conBancoId.length).toBeGreaterThan(0);

    for (const tabla of conBancoId) {
      expect(migracion, `${tabla} sin ENABLE RLS`).toContain(
        `ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY;`,
      );
      expect(migracion, `${tabla} sin FORCE RLS`).toContain(
        `ALTER TABLE ${tabla} FORCE ROW LEVEL SECURITY;`,
      );
    }
  });

  it('la migración deja instalada la función que verifica las políticas', () => {
    expect(migracion).toContain('CREATE OR REPLACE FUNCTION "core"."verificar_politicas_rls"()');
    expect(migracion).toContain('SELECT "core"."verificar_politicas_rls"();');
  });

  it('la migración Auth0 conserva los datos de contacto hasta aprobar el modelo de usuarios', () => {
    expect(migracion).not.toContain('DROP COLUMN IF EXISTS "email"');
    expect(migracion).not.toContain('DROP COLUMN IF EXISTS "nombre"');
  });

  it('el contexto de banco solo se compara como uuid, sin valores especiales', () => {
    // Un valor no-UUID en app.banco_id revienta el cast de las demás políticas.
    expect(migracion).not.toMatch(/current_setting\('app\.banco_id'[^)]*\)\s*=\s*'(?!')/);
  });
});

describe('Propagación del contexto de tenant', () => {
  it('aísla el contexto entre ejecuciones anidadas y lo suelta al salir', async () => {
    const bancoA: TenantContext = { bancoId: '11111111-1111-1111-1111-111111111111' };
    const bancoB: TenantContext = { bancoId: '22222222-2222-2222-2222-222222222222' };

    await runWithTenantContext(bancoA, async () => {
      expect(getTenantContext()?.bancoId).toBe(bancoA.bancoId);

      await runWithTenantContext(bancoB, () => {
        expect(getTenantContext()?.bancoId).toBe(bancoB.bancoId);
      });

      expect(getTenantContext()?.bancoId).toBe(bancoA.bancoId);
    });

    expect(getTenantContext()).toBeUndefined();
  });
});

describe('La transacción fija el contexto sin concatenar SQL', () => {
  /** Captura las llamadas a `$executeRaw`, que es una plantilla etiquetada. */
  function clienteFalso() {
    const llamadas: { sql: string; valores: unknown[] }[] = [];

    const tx = {
      $executeRaw: vi.fn(async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        llamadas.push({ sql: partes.join('?'), valores });
        return 1;
      }),
    } as unknown as Prisma.TransactionClient;

    const cliente = {
      $transaction: vi.fn(async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(tx)),
    };

    return { cliente, llamadas };
  }

  it('usa set_config con el identificador como parámetro, no dentro del SQL', async () => {
    const { cliente, llamadas } = clienteFalso();
    const banco = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const institucion = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const usuario = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    await executeTransactionWithTenant(cliente, async () => 'listo', {
      bancoId: banco,
      institucionId: institucion,
      usuarioId: usuario,
    });

    // Una sola ida a la base por transacción (SBA-97).
    expect(llamadas).toHaveLength(1);
    const [llamada] = llamadas;
    expect(llamada?.sql.match(/set_config/g)).toHaveLength(4);
    // El valor viaja como parámetro: nunca aparece incrustado en el texto.
    expect(llamada?.sql).not.toContain(banco);
    expect(llamada?.sql).not.toContain(institucion);
    expect(llamada?.sql).not.toContain(usuario);

    expect(llamada?.valores).toEqual([
      'app.banco_id',
      banco,
      'app.institucion_id',
      institucion,
      'app.usuario_id',
      usuario,
      'app.actor',
      '',
    ]);
  });

  it('sin contexto envía cadena vacía, que las políticas rechazan', async () => {
    const { cliente, llamadas } = clienteFalso();

    await executeTransactionWithTenant(cliente, async () => 'listo', {});

    expect(llamadas[0]?.valores).toEqual([
      'app.banco_id',
      '',
      'app.institucion_id',
      '',
      'app.usuario_id',
      '',
      'app.actor',
      '',
    ]);
  });

  it('un actor de comando no se usa como identificador de usuario para RLS', async () => {
    const { cliente, llamadas } = clienteFalso();

    await executeTransactionWithTenant(cliente, async () => 'listo', {
      bancoId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      actor: 'importar-codigos',
    });

    expect(llamadas[0]?.valores.slice(4)).toEqual([
      'app.usuario_id',
      '',
      'app.actor',
      'importar-codigos',
    ]);
  });

  it('un identificador con comillas no se convierte en SQL', async () => {
    const { cliente, llamadas } = clienteFalso();
    const malicioso = "'; DROP TABLE plataforma.bodega; --";

    await executeTransactionWithTenant(cliente, async () => 'listo', { bancoId: malicioso });

    expect(llamadas[0]?.sql).not.toContain('DROP TABLE');
    expect(llamadas[0]?.valores.slice(0, 2)).toEqual(['app.banco_id', malicioso]);
  });
});
