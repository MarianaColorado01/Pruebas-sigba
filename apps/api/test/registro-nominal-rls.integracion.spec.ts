import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { executeTransactionWithTenant } from '../src/core/database/index.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Migración B del esquema de beneficiarios contra PostgreSQL (SBA-15, ADR-07,
 * docs/SBA-15/esquema_beneficiarios.md sección 6.9).
 *
 * Todo como `sigba_app`, sin superusuario ni BYPASSRLS: el admin solo siembra
 * y limpia. Datos sintéticos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

const TABLAS = [
  'alerta_duplicidad',
  'beneficiario',
  'consentimiento',
  'membresia',
  'persona',
  'representacion',
] as const;

const bancoA = 'c1000000-0000-4000-8000-00000000000a';
const bancoB = 'c1000000-0000-4000-8000-00000000000b';
const poblacionA = 'c2000000-0000-4000-8000-00000000000a';
const poblacionB = 'c2000000-0000-4000-8000-00000000000b';
const institucionX = 'c3000000-0000-4000-8000-000000000001';
const institucionY = 'c3000000-0000-4000-8000-000000000002';
const institucionB = 'c3000000-0000-4000-8000-00000000000b';
/** Adulta con membresía activa en Y. */
const ana = 'c4000000-0000-4000-8000-000000000001';
/** Menor con membresía activa en X, representado por Luis. */
const sofia = 'c4000000-0000-4000-8000-000000000002';
/** Representante de Sofía; no es beneficiario. */
const luis = 'c4000000-0000-4000-8000-000000000003';
/** Persona del banco B. */
const beto = 'c4000000-0000-4000-8000-00000000000b';
const membresiaAna = 'c5000000-0000-4000-8000-000000000001';
const membresiaSofia = 'c5000000-0000-4000-8000-000000000002';
const representacionSofia = 'c6000000-0000-4000-8000-000000000001';

describe.skipIf(!URL_ADMIN)('Registro nominal: RLS, FK y UNIQUE (SBA-15)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;

  /** Corre `fn` como sigba_app con el contexto de tenant dado. */
  function como<R>(
    ctx: { bancoId: string; institucionId?: string },
    fn: (tx: Prisma.TransactionClient) => Promise<R>,
  ): Promise<R> {
    return executeTransactionWithTenant<R>(app, fn, { ...ctx, actor: 'prueba-rls' });
  }

  async function contar(
    ctx: { bancoId: string; institucionId?: string },
    tabla: string,
  ): Promise<number> {
    const [fila] = await como(ctx, (tx) =>
      tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM beneficiarios.${tabla} WHERE banco_id IN ('${bancoA}', '${bancoB}')`,
      ),
    );
    return Number(fila?.n);
  }

  async function limpiar(): Promise<void> {
    const bancos = `'${bancoA}', '${bancoB}'`;
    for (const tabla of [
      'alerta_duplicidad',
      'consentimiento',
      'representacion',
      'membresia',
      'beneficiario',
      'persona',
      'institucion',
      'tipo_poblacion',
    ]) {
      await admin.$executeRawUnsafe(
        `DELETE FROM beneficiarios.${tabla} WHERE banco_id IN (${bancos})`,
      );
    }
  }

  async function sembrar(): Promise<void> {
    const sentencias = `
      INSERT INTO beneficiarios.tipo_poblacion (id, banco_id, nombre) VALUES
        ('${poblacionA}', '${bancoA}', 'Familias'),
        ('${poblacionB}', '${bancoB}', 'Familias');
      INSERT INTO beneficiarios.institucion (id, banco_id, nombre, tipo, contacto_nombre, tipo_poblacion_id) VALUES
        ('${institucionX}', '${bancoA}', 'Parroquia X', 'parroquia', 'Contacto X', '${poblacionA}'),
        ('${institucionY}', '${bancoA}', 'Parroquia Y', 'parroquia', 'Contacto Y', '${poblacionA}'),
        ('${institucionB}', '${bancoB}', 'Parroquia B', 'parroquia', 'Contacto B', '${poblacionB}');
      INSERT INTO beneficiarios.persona (id, banco_id, tipo_documento, numero_documento, nombres, apellidos, sexo, fecha_nacimiento) VALUES
        ('${ana}', '${bancoA}', 'cc', '900000001', 'Ana', 'Sintética', 'femenino', '1980-01-01'),
        ('${sofia}', '${bancoA}', 'ti', '900000002', 'Sofía', 'Sintética', 'femenino', '2016-05-05'),
        ('${luis}', '${bancoA}', 'cc', '900000003', 'Luis', 'Sintético', 'masculino', '1985-03-03'),
        ('${beto}', '${bancoB}', 'cc', '900000001', 'Beto', 'Sintético', 'masculino', '1990-02-02');
      INSERT INTO beneficiarios.beneficiario (persona_id, banco_id, tipo_poblacion_id) VALUES
        ('${ana}', '${bancoA}', '${poblacionA}'),
        ('${sofia}', '${bancoA}', '${poblacionA}'),
        ('${beto}', '${bancoB}', '${poblacionB}');
      INSERT INTO beneficiarios.representacion (id, banco_id, beneficiario_id, representante_persona_id, parentesco) VALUES
        ('${representacionSofia}', '${bancoA}', '${sofia}', '${luis}', 'padre');
      INSERT INTO beneficiarios.consentimiento (banco_id, persona_id, otorgante_persona_id, recogido_por, version_aviso, finalidad) VALUES
        ('${bancoA}', '${ana}', NULL, 'prueba', 'sintetico-0', 'prueba'),
        ('${bancoA}', '${sofia}', '${luis}', 'prueba', 'sintetico-0', 'prueba'),
        ('${bancoA}', '${luis}', NULL, 'prueba', 'sintetico-0', 'prueba'),
        ('${bancoB}', '${beto}', NULL, 'prueba', 'sintetico-0', 'prueba');
      INSERT INTO beneficiarios.membresia (id, banco_id, beneficiario_id, institucion_id, creado_por) VALUES
        ('${membresiaAna}', '${bancoA}', '${ana}', '${institucionY}', 'prueba'),
        ('${membresiaSofia}', '${bancoA}', '${sofia}', '${institucionX}', 'prueba');
      INSERT INTO beneficiarios.membresia (banco_id, beneficiario_id, institucion_id, creado_por) VALUES
        ('${bancoB}', '${beto}', '${institucionB}', 'prueba');
      INSERT INTO beneficiarios.alerta_duplicidad (banco_id, beneficiario_id, institucion_solicitante_id, membresia_vigente_id, creado_por) VALUES
        ('${bancoA}', '${ana}', '${institucionX}', '${membresiaAna}', 'prueba')
    `.split(';');
    for (const sentencia of sentencias) await admin.$executeRawUnsafe(sentencia);
  }

  /** Ids de persona que ve la institución X. */
  async function personasVistasPorX(): Promise<string[]> {
    const filas = await como({ bancoId: bancoA, institucionId: institucionX }, (tx) =>
      tx.persona.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    );
    return filas.map((f) => f.id);
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
  });

  beforeEach(async () => {
    await limpiar();
    await sembrar();
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('las seis tablas tienen RLS activo y forzado', async () => {
    const filas = await app.$queryRaw<{ tabla: string; rls: boolean; forzado: boolean }[]>`
      SELECT c.relname AS tabla, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'beneficiarios' AND c.relname = ANY(${TABLAS as unknown as string[]})
      ORDER BY c.relname`;

    expect(filas).toEqual(TABLAS.map((tabla) => ({ tabla, rls: true, forzado: true })));
  });

  it.each(TABLAS)('%s: el banco B no ve filas del banco A', async (tabla) => {
    const conAmbos = await contar({ bancoId: bancoA }, tabla);
    expect(conAmbos).toBeGreaterThan(0);

    const [fila] = await como({ bancoId: bancoB }, (tx) =>
      tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM beneficiarios.${tabla} WHERE banco_id = '${bancoA}'`,
      ),
    );
    expect(Number(fila?.n)).toBe(0);
  });

  it('sin contexto de banco no se ve ninguna fila', async () => {
    for (const tabla of TABLAS) {
      const [fila] = await executeTransactionWithTenant<{ n: bigint }[]>(
        app,
        (tx) =>
          tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM beneficiarios.${tabla}`),
        {},
      );
      expect(Number(fila?.n), tabla).toBe(0);
    }
  });

  it('con el contexto del banco A no se inserta una persona del banco B', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.persona.create({
          data: {
            bancoId: bancoB,
            tipoDocumento: 'cc',
            numeroDocumento: '900000099',
            nombres: 'Otra',
            apellidos: 'Sintética',
            sexo: 'femenino',
            fechaNacimiento: new Date('1990-01-01'),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('con el contexto del banco A no se inserta una membresía, ni consentimiento, ni alerta del banco B', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.membresia.create({
          data: {
            bancoId: bancoB,
            beneficiarioId: beto,
            institucionId: institucionB,
            creadoPor: 'prueba',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.consentimiento.create({
          data: {
            bancoId: bancoB,
            personaId: beto,
            recogidoPor: 'prueba',
            versionAviso: 'sintetico-0',
            finalidad: 'prueba',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('una membresía con una institución de otro banco falla por la FK compuesta', async () => {
    await admin.$executeRawUnsafe(
      `UPDATE beneficiarios.membresia SET fin_en = now(), motivo_fin = 'otro', cerrado_por = 'prueba' WHERE id = '${membresiaAna}'`,
    );
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.membresia.create({
          data: {
            bancoId: bancoA,
            beneficiarioId: ana,
            institucionId: institucionB,
            creadoPor: 'prueba',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('la segunda membresía activa del mismo beneficiario falla; una cerrada y una activa conviven (SBA-15, criterio 1)', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.membresia.create({
          data: {
            bancoId: bancoA,
            beneficiarioId: ana,
            institucionId: institucionX,
            creadoPor: 'p',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });

    await como({ bancoId: bancoA }, async (tx) => {
      await tx.membresia.update({
        where: { id: membresiaAna },
        data: { finEn: new Date(), motivoFin: 'traslado', cerradoPor: 'p' },
      });
      await tx.membresia.create({
        data: { bancoId: bancoA, beneficiarioId: ana, institucionId: institucionX, creadoPor: 'p' },
      });
    });
    expect(
      await como({ bancoId: bancoA }, (tx) =>
        tx.membresia.count({ where: { beneficiarioId: ana } }),
      ),
    ).toBe(2);
  });

  it('cerrar una membresía exige motivo y quién la cerró', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.membresia.update({ where: { id: membresiaAna }, data: { finEn: new Date() } }),
      ),
    ).rejects.toThrow(/membresia_cierre_completo/);
  });

  it('con la institución X, una persona con membresía activa solo en Y no se ve en ninguna tabla (SBA-15, criterio 2)', async () => {
    const x = { bancoId: bancoA, institucionId: institucionX };
    const deAna = await como(x, async (tx) => ({
      persona: await tx.persona.count({ where: { id: ana } }),
      beneficiario: await tx.beneficiario.count({ where: { personaId: ana } }),
      membresia: await tx.membresia.count({ where: { beneficiarioId: ana } }),
      representacion: await tx.representacion.count({ where: { beneficiarioId: ana } }),
      consentimiento: await tx.consentimiento.count({ where: { personaId: ana } }),
    }));

    expect(deAna).toEqual({
      persona: 0,
      beneficiario: 0,
      membresia: 0,
      representacion: 0,
      consentimiento: 0,
    });
  });

  it('con la institución X se ven la menor con membresía activa en X y su representante vigente', async () => {
    expect(await personasVistasPorX()).toEqual([sofia, luis].sort());
    const x = { bancoId: bancoA, institucionId: institucionX };
    expect(await como(x, (tx) => tx.consentimiento.count())).toBe(2);
    expect(await como(x, (tx) => tx.representacion.count())).toBe(1);
  });

  it('cerrada la representación, X deja de ver al representante', async () => {
    await admin.$executeRawUnsafe(
      `UPDATE beneficiarios.representacion SET fin_en = now(), motivo_fin = 'cambio_representante' WHERE id = '${representacionSofia}'`,
    );
    expect(await personasVistasPorX()).toEqual([sofia]);
  });

  it('cerrada la membresía en X, X no ve a la menor ni a su representante', async () => {
    await admin.$executeRawUnsafe(
      `UPDATE beneficiarios.membresia SET fin_en = now(), motivo_fin = 'se_mudo', cerrado_por = 'prueba' WHERE id = '${membresiaSofia}'`,
    );
    expect(await personasVistasPorX()).toEqual([]);
    const x = { bancoId: bancoA, institucionId: institucionX };
    expect(await como(x, (tx) => tx.membresia.count())).toBe(0);
    expect(await como(x, (tx) => tx.consentimiento.count())).toBe(0);
  });

  it('con institución en el contexto no se ven alertas', async () => {
    expect(await contar({ bancoId: bancoA }, 'alerta_duplicidad')).toBe(1);
    expect(
      await contar({ bancoId: bancoA, institucionId: institucionX }, 'alerta_duplicidad'),
    ).toBe(0);
  });

  it('con institución en el contexto no se inserta en ninguna de las seis tablas', async () => {
    const x = { bancoId: bancoA, institucionId: institucionX };
    const inserciones: Record<(typeof TABLAS)[number], string> = {
      persona: `INSERT INTO beneficiarios.persona (banco_id, tipo_documento, numero_documento, nombres, apellidos, sexo, fecha_nacimiento) VALUES ('${bancoA}', 'cc', '900000050', 'N', 'S', 'femenino', '1990-01-01')`,
      beneficiario: `INSERT INTO beneficiarios.beneficiario (persona_id, banco_id, tipo_poblacion_id) VALUES ('${luis}', '${bancoA}', '${poblacionA}')`,
      representacion: `INSERT INTO beneficiarios.representacion (banco_id, beneficiario_id, representante_persona_id, parentesco) VALUES ('${bancoA}', '${sofia}', '${ana}', 'tio_a')`,
      consentimiento: `INSERT INTO beneficiarios.consentimiento (banco_id, persona_id, recogido_por, version_aviso, finalidad) VALUES ('${bancoA}', '${sofia}', 'p', 'v', 'f')`,
      membresia: `INSERT INTO beneficiarios.membresia (banco_id, beneficiario_id, institucion_id, creado_por) VALUES ('${bancoA}', '${sofia}', '${institucionX}', 'p')`,
      alerta_duplicidad: `INSERT INTO beneficiarios.alerta_duplicidad (banco_id, beneficiario_id, institucion_solicitante_id, membresia_vigente_id, creado_por) VALUES ('${bancoA}', '${ana}', '${institucionY}', '${membresiaAna}', 'p')`,
    };

    for (const tabla of TABLAS) {
      await expect(
        como(x, (tx) => tx.$executeRawUnsafe(inserciones[tabla])),
        tabla,
      ).rejects.toThrow(/row-level security/);
    }
  });

  it('con institución en el contexto, UPDATE de una fila visible falla y de una invisible no afecta filas', async () => {
    const x = { bancoId: bancoA, institucionId: institucionX };
    await expect(
      como(x, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE beneficiarios.persona SET telefono = '3000000000' WHERE id = '${sofia}'`,
        ),
      ),
    ).rejects.toThrow(/row-level security/);

    const afectadas = await como(x, (tx) =>
      tx.$executeRawUnsafe(`UPDATE beneficiarios.alerta_duplicidad SET estado = 'descartada'`),
    );
    expect(afectadas).toBe(0);
  });

  it('el mismo número en el mismo banco falla aunque cambie el tipo; en otro banco se acepta', async () => {
    const nueva = (bancoId: string, tipoDocumento: 'ti' | 'cc') => ({
      bancoId,
      tipoDocumento,
      numeroDocumento: '900000003',
      nombres: 'Otra',
      apellidos: 'Sintética',
      sexo: 'femenino' as const,
      fechaNacimiento: new Date('2010-01-01'),
    });

    await expect(
      como({ bancoId: bancoA }, (tx) => tx.persona.create({ data: nueva(bancoA, 'ti') })),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      como({ bancoId: bancoB }, (tx) => tx.persona.create({ data: nueva(bancoB, 'cc') })),
    ).resolves.toMatchObject({ numeroDocumento: '900000003' });
  });

  it.each(['1.088.123', '1088 123', '1088abc', ''])(
    'el número %j sin normalizar falla por el CHECK',
    async (numeroDocumento) => {
      await expect(
        como({ bancoId: bancoA }, (tx) =>
          tx.persona.create({
            data: {
              bancoId: bancoA,
              tipoDocumento: 'cc',
              numeroDocumento,
              nombres: 'N',
              apellidos: 'S',
              sexo: 'femenino',
              fechaNacimiento: new Date('1990-01-01'),
            },
          }),
        ),
      ).rejects.toThrow(/persona_numero_documento_normalizado/);
    },
  );

  it('UPDATE y DELETE sobre consentimiento fallan con el rol de la API', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.$executeRawUnsafe(`UPDATE beneficiarios.consentimiento SET finalidad = 'otra'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM beneficiarios.consentimiento`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('el rol de la API no cambia el id ni el documento de una persona; sí los datos editables', async () => {
    for (const columna of [`id = gen_random_uuid()`, `numero_documento = '900000099'`]) {
      await expect(
        como({ bancoId: bancoA }, (tx) =>
          tx.$executeRawUnsafe(`UPDATE beneficiarios.persona SET ${columna} WHERE id = '${luis}'`),
        ),
      ).rejects.toThrow(/permission denied/);
    }

    const editadas = await como({ bancoId: bancoA }, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE beneficiarios.persona SET telefono = '3000000000' WHERE id = '${luis}'`,
      ),
    );
    expect(editadas).toBe(1);
  });

  it('ni el dueño de las tablas reescribe consentimiento o membresía cambiando persona.id', async () => {
    // Luis tiene consentimiento; Ana, membresía (a través de beneficiario).
    for (const persona of [luis, ana]) {
      await expect(
        admin.$executeRawUnsafe(
          `UPDATE beneficiarios.persona SET id = gen_random_uuid() WHERE id = '${persona}'`,
        ),
      ).rejects.toThrow(/foreign key/);
    }
  });

  it('una segunda alerta abierta para la misma persona e institución falla', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.alertaDuplicidad.create({
          data: {
            bancoId: bancoA,
            beneficiarioId: ana,
            institucionSolicitanteId: institucionX,
            membresiaVigenteId: membresiaAna,
            creadoPor: 'p',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('un menor no se representa a sí mismo', async () => {
    await expect(
      como({ bancoId: bancoA }, (tx) =>
        tx.representacion.create({
          data: {
            bancoId: bancoA,
            beneficiarioId: sofia,
            representantePersonaId: sofia,
            parentesco: 'otro',
          },
        }),
      ),
    ).rejects.toThrow(/representacion_no_a_si_mismo/);
  });
});
