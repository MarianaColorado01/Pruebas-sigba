import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { InstitucionesPrismaRepositorio } from '../src/modules/beneficiarios/repositories/instituciones.prisma.repositorio.js';
import {
  type DatosDeInstitucion,
  NombreDeInstitucionRepetido,
  TipoDePoblacionInexistente,
} from '../src/modules/beneficiarios/services/institucion.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Directorio de instituciones contra PostgreSQL (SBA-26, ADR-07).
 *
 * Prueba el adaptador de Prisma con el rol sin privilegios de
 * `rol-de-aplicacion.ts`: RLS por banco, la FK compuesta, el nombre único sin
 * importar mayúsculas y el registro de quién y cuándo. Las reglas del alta las
 * cubre `directorio-de-instituciones.service.spec.ts` sin base de datos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error(
    'DATABASE_URL no está definida en CI. La prueba de aislamiento no es opcional (RNF-01).',
  );
}

describe.skipIf(!URL_ADMIN)('Directorio de instituciones contra PostgreSQL (SBA-26)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let repositorio: InstitucionesPrismaRepositorio;

  const bancoA = '88888888-8888-8888-8888-888888888888';
  const bancoB = '99999999-9999-9999-9999-999999999999';
  const poblacionA = 'aaaaaaaa-0000-0000-0000-00000000000a';
  const poblacionB = 'bbbbbbbb-0000-0000-0000-00000000000b';

  function enBanco<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, actor: 'coordinacion-prueba' }, fn) as Promise<R>;
  }

  function datos(sobrescribir: Partial<DatosDeInstitucion> = {}): DatosDeInstitucion {
    return {
      nombre: 'Parroquia San José',
      tipo: 'parroquia',
      contactoNombre: 'María Gómez',
      contactoTelefono: null,
      contactoCorreo: null,
      direccion: null,
      diaRecogida: null,
      tipoPoblacionId: poblacionA,
      ...sobrescribir,
    };
  }

  async function limpiar(): Promise<void> {
    const bancos = `'${bancoA}', '${bancoB}'`;
    await admin.$executeRawUnsafe(
      `DELETE FROM beneficiarios.institucion WHERE banco_id IN (${bancos})`,
    );
    await admin.$executeRawUnsafe(
      `DELETE FROM beneficiarios.tipo_poblacion WHERE banco_id IN (${bancos})`,
    );
  }

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });

    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    // PrismaService es un PrismaClient; aquí va uno conectado con el rol de la app.
    repositorio = new InstitucionesPrismaRepositorio(app as PrismaService);
  });

  beforeEach(async () => {
    await limpiar();
    await admin.$executeRawUnsafe(
      `INSERT INTO beneficiarios.tipo_poblacion (id, banco_id, nombre) VALUES
         ('${poblacionA}', '${bancoA}', 'Familias'),
         ('${poblacionB}', '${bancoB}', 'Familias')`,
    );
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('las dos tablas tienen RLS activo y forzado', async () => {
    const filas = await app.$queryRaw<{ tabla: string; rls: boolean; forzado: boolean }[]>`
      SELECT c.relname AS tabla, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzado
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'beneficiarios' AND c.relname IN ('institucion', 'tipo_poblacion')
      ORDER BY c.relname`;

    expect(filas).toEqual([
      { tabla: 'institucion', rls: true, forzado: true },
      { tabla: 'tipo_poblacion', rls: true, forzado: true },
    ]);
  });

  it('crea con banco, actor y fecha de la petición', async () => {
    const institucion = await enBanco(bancoA, () => repositorio.crear(datos()));

    expect(institucion).toMatchObject({
      nombre: 'Parroquia San José',
      activa: true,
      actualizadoPor: 'coordinacion-prueba',
    });
    expect(institucion.actualizadoEn).toBeInstanceOf(Date);

    const [fila] = await admin.$queryRaw<{ banco_id: string }[]>`
      SELECT banco_id::text FROM beneficiarios.institucion WHERE id = ${institucion.id}::uuid`;
    expect(fila).toEqual({ banco_id: bancoA });
  });

  it('el banco B no ve las instituciones del banco A', async () => {
    await enBanco(bancoA, () => repositorio.crear(datos()));

    const vistas = await enBanco(bancoB, () => repositorio.buscar({ soloActivas: false }));

    expect(vistas).toHaveLength(0);
  });

  it('el banco B no puede editar una institución del banco A', async () => {
    const { id } = await enBanco(bancoA, () => repositorio.crear(datos()));

    const editada = await enBanco(bancoB, () => repositorio.actualizar(id, { nombre: 'Robada' }));

    expect(editada).toBeNull();
    const [fila] = await admin.$queryRaw<{ nombre: string }[]>`
      SELECT nombre FROM beneficiarios.institucion WHERE id = ${id}::uuid`;
    expect(fila?.nombre).toBe('Parroquia San José');
  });

  it('no deja crear una institución con el banco de otro', async () => {
    // Las políticas lo impiden aunque el adaptador se equivocara: se prueba
    // directo contra la tabla con el contexto del banco A.
    await expect(
      enBanco(bancoA, () =>
        app.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoA}, true)`;
          await tx.$executeRaw`INSERT INTO beneficiarios.institucion
            (banco_id, nombre, tipo, contacto_nombre, tipo_poblacion_id)
            VALUES (${bancoB}::uuid, 'Intrusa', 'parroquia', 'X', ${poblacionB}::uuid)`;
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('el banco B no ve los tipos de población del banco A', async () => {
    const vistos = await app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoB}, true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM beneficiarios.tipo_poblacion`;
    });

    expect(vistos.map((fila) => fila.id)).toEqual([poblacionB]);
  });

  it('no deja crear un tipo de población con el banco de otro', async () => {
    await expect(
      app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.banco_id', ${bancoA}, true)`;
        await tx.$executeRaw`INSERT INTO beneficiarios.tipo_poblacion (banco_id, nombre)
          VALUES (${bancoB}::uuid, 'Intruso')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('no deja colgar una institución de un tipo de población de otro banco', async () => {
    await expect(
      enBanco(bancoA, () => repositorio.crear(datos({ tipoPoblacionId: poblacionB }))),
    ).rejects.toThrow(TipoDePoblacionInexistente);
  });

  it('rechaza un nombre repetido con otras mayúsculas en el mismo banco y lo acepta en otro', async () => {
    await enBanco(bancoA, () => repositorio.crear(datos()));

    await expect(
      enBanco(bancoA, () => repositorio.crear(datos({ nombre: 'PARROQUIA SAN JOSÉ' }))),
    ).rejects.toThrow(NombreDeInstitucionRepetido);

    await expect(
      enBanco(bancoB, () => repositorio.crear(datos({ tipoPoblacionId: poblacionB }))),
    ).resolves.toBeDefined();
  });

  it('busca por parte del nombre sin importar mayúsculas, en orden alfabético', async () => {
    await enBanco(bancoA, async () => {
      await repositorio.crear(datos({ nombre: 'Parroquia San José' }));
      await repositorio.crear(datos({ nombre: 'Fundación Santa Ana', tipo: 'fundacion' }));
      await repositorio.crear(
        datos({ nombre: 'Comunidad La Esperanza', tipo: 'comunidad_religiosa' }),
      );
    });

    const encontradas = await enBanco(bancoA, () =>
      repositorio.buscar({ texto: 'SAN', soloActivas: true }),
    );

    expect(encontradas.map((i) => i.nombre)).toEqual(['Fundación Santa Ana', 'Parroquia San José']);
  });

  it('con tipo solo devuelve ese tipo', async () => {
    await enBanco(bancoA, async () => {
      await repositorio.crear(datos({ nombre: 'Parroquia San José' }));
      await repositorio.crear(datos({ nombre: 'Fundación Santa Ana', tipo: 'fundacion' }));
    });

    const fundaciones = await enBanco(bancoA, () =>
      repositorio.buscar({ tipo: 'fundacion', soloActivas: true }),
    );

    expect(fundaciones.map((i) => i.nombre)).toEqual(['Fundación Santa Ana']);
  });

  it('una institución desactivada sale del listado de activas pero no de administración', async () => {
    const { id } = await enBanco(bancoA, () => repositorio.crear(datos()));
    await enBanco(bancoA, () => repositorio.actualizar(id, { activa: false }));

    const activas = await enBanco(bancoA, () => repositorio.buscar({ soloActivas: true }));
    const todas = await enBanco(bancoA, () => repositorio.buscar({ soloActivas: false }));

    expect(activas).toHaveLength(0);
    expect(todas.map((i) => i.activa)).toEqual([false]);
  });

  it('un cambio de contacto deja quién y cuándo', async () => {
    const { id, actualizadoEn: antes } = await enBanco(bancoA, () => repositorio.crear(datos()));

    const editada = await runWithTenantContext(
      { bancoId: bancoA, actor: 'otra-coordinadora' },
      () => repositorio.actualizar(id, { contactoTelefono: '310 111 1111' }),
    );

    expect(editada).toMatchObject({
      contactoTelefono: '310 111 1111',
      nombre: 'Parroquia San José',
      actualizadoPor: 'otra-coordinadora',
    });
    expect(editada?.actualizadoEn?.getTime()).toBeGreaterThanOrEqual(antes?.getTime() ?? 0);
  });

  it('sin banco en el contexto no escribe', async () => {
    await expect(repositorio.crear(datos())).rejects.toThrow(/sin banco en el contexto/);
  });

  it('sin usuario en el contexto no escribe', async () => {
    await expect(
      runWithTenantContext({ bancoId: bancoA }, () => repositorio.crear(datos())),
    ).rejects.toThrow(/sin usuario en el contexto/);
  });
});
