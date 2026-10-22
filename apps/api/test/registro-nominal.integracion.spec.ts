import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AVISO_DE_PRIVACIDAD } from '@sigba/shared-types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/core/auditoria/audit.service.js';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { RegistroPrismaRepositorio } from '../src/modules/beneficiarios/repositories/registro.prisma.repositorio.js';
import {
  type AltaDeBeneficiario,
  RegistroDeBeneficiariosService,
} from '../src/modules/beneficiarios/services/registro-de-beneficiarios.service.js';
import { RegistroSimultaneo } from '../src/modules/beneficiarios/services/registro.js';
import { urlComoRolApp } from './rol-de-aplicacion.js';

/**
 * Alta del registro nominal contra PostgreSQL, como sigba_app (SBA-27, SBA-28).
 * Las reglas las prueba el spec del service; aquí, que el adaptador escribe
 * todo en una transacción, con auditoría, y que la alerta queda guardada
 * aunque la respuesta sea 409. Datos sintéticos.
 */

const URL_ADMIN = process.env['DATABASE_URL'];

if (process.env['CI'] && !URL_ADMIN) {
  throw new Error('DATABASE_URL no está definida en CI. La prueba de integración no es opcional.');
}

// La auditoría es append-only, ni el admin la borra: cada prueba usa bancos nuevos.
let banco: string;
let otroBanco: string;
let poblacion: string;
let poblacionOtroBanco: string;
let institucionX: string;
let institucionY: string;
const bancosUsados: string[] = [];
const actor = 'd9000000-0000-4000-8000-000000000001';

describe.skipIf(!URL_ADMIN)('Registro nominal contra PostgreSQL (SBA-27, SBA-28)', () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let servicio: RegistroDeBeneficiariosService;

  function en<R>(bancoId: string, fn: () => Promise<R>): Promise<R> {
    return runWithTenantContext({ bancoId, usuarioId: actor }, fn) as Promise<R>;
  }

  function alta(sobrescribir: Partial<AltaDeBeneficiario> = {}): AltaDeBeneficiario {
    return {
      institucionId: institucionX,
      tipoPoblacionId: poblacion,
      persona: {
        tipoDocumento: 'cc',
        numeroDocumento: '1.077.000.001',
        nombres: 'Ana',
        apellidos: 'Sintética',
        sexo: 'femenino',
        fechaNacimiento: '1980-01-01',
      },
      consentimiento: { otorgado: true, versionAviso: AVISO_DE_PRIVACIDAD.version },
      ...sobrescribir,
    };
  }

  const menor: AltaDeBeneficiario['persona'] = {
    tipoDocumento: 'registro_civil',
    numeroDocumento: '1077000002',
    nombres: 'Sofía',
    apellidos: 'Sintética',
    sexo: 'femenino',
    fechaNacimiento: '2019-04-04',
  };
  const padre: AltaDeBeneficiario['persona'] = {
    tipoDocumento: 'cc',
    numeroDocumento: '1077000003',
    nombres: 'Luis',
    apellidos: 'Sintético',
    sexo: 'masculino',
    fechaNacimiento: '1985-03-03',
  };

  async function contar(tabla: string): Promise<number> {
    const [fila] = await admin.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM beneficiarios.${tabla} WHERE banco_id = '${banco}'`,
    );
    return Number(fila?.n);
  }

  async function limpiar(): Promise<void> {
    if (bancosUsados.length === 0) return;
    const bancos = bancosUsados.map((b) => `'${b}'`).join(', ');
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

  beforeAll(() => {
    admin = new PrismaClient({ datasourceUrl: URL_ADMIN });
    app = new PrismaClient({ datasourceUrl: urlComoRolApp(URL_ADMIN as string) });
    servicio = new RegistroDeBeneficiariosService(
      new RegistroPrismaRepositorio(app as PrismaService, new AuditService()),
    );
  });

  beforeEach(async () => {
    [banco, otroBanco, poblacion, poblacionOtroBanco, institucionX, institucionY] = Array.from(
      { length: 6 },
      () => randomUUID(),
    ) as [string, string, string, string, string, string];
    bancosUsados.push(banco, otroBanco);
    for (const sentencia of [
      `INSERT INTO beneficiarios.tipo_poblacion (id, banco_id, nombre) VALUES
         ('${poblacion}', '${banco}', 'Familias'), ('${poblacionOtroBanco}', '${otroBanco}', 'Familias')`,
      `INSERT INTO beneficiarios.institucion (id, banco_id, nombre, tipo, contacto_nombre, tipo_poblacion_id) VALUES
         ('${institucionX}', '${banco}', 'Parroquia X', 'parroquia', 'Contacto', '${poblacion}'),
         ('${institucionY}', '${banco}', 'Parroquia Y', 'parroquia', 'Contacto', '${poblacion}')`,
    ]) {
      await admin.$executeRawUnsafe(sentencia);
    }
  });

  afterAll(async () => {
    if (admin) {
      await limpiar();
      await admin.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  it('un menor con su representante: todas las filas y su auditoría en una transacción', async () => {
    const resultado = await en(banco, () =>
      servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      ),
    );

    expect(resultado).toMatchObject({ resultado: 'creada' });
    expect({
      persona: await contar('persona'),
      beneficiario: await contar('beneficiario'),
      representacion: await contar('representacion'),
      consentimiento: await contar('consentimiento'),
      membresia: await contar('membresia'),
    }).toEqual({ persona: 2, beneficiario: 1, representacion: 1, consentimiento: 2, membresia: 1 });

    const auditadas = await admin.$queryRaw<{ entidad: string }[]>`
      SELECT entidad FROM core.auditoria
      WHERE banco_id = ${banco}::uuid AND accion = 'crear' ORDER BY entidad`;
    expect(auditadas.map((a) => a.entidad)).toEqual([
      'beneficiario',
      'consentimiento',
      'consentimiento',
      'membresia',
      'persona',
      'persona',
      'representacion',
    ]);

    const [consentimiento] = await admin.$queryRaw<{ recogido_por: string; otorgante: string }[]>`
      SELECT recogido_por, otorgante_persona_id::text AS otorgante FROM beneficiarios.consentimiento
      WHERE banco_id = ${banco}::uuid AND otorgante_persona_id IS NOT NULL`;
    expect(consentimiento?.recogido_por).toBe(actor);
  });

  it('el documento se guarda normalizado', async () => {
    await en(banco, () => servicio.registrar(alta()));
    const [fila] = await admin.$queryRaw<{ numero_documento: string }[]>`
      SELECT numero_documento FROM beneficiarios.persona WHERE banco_id = ${banco}::uuid`;
    expect(fila?.numero_documento).toBe('1077000001');
  });

  it('una falla a mitad del alta no deja filas', async () => {
    // El tipo de población de otro banco no existe para este: 404 después de crear la persona.
    await expect(
      en(banco, () => servicio.registrar(alta({ tipoPoblacionId: poblacionOtroBanco }))),
    ).rejects.toThrow('tipo de población');
    expect(await contar('persona')).toBe(0);
  });

  it('una duplicidad confirma la alerta y no crea membresía (SBA-28, criterio 1)', async () => {
    await en(banco, () => servicio.registrar(alta()));

    const resultado = await en(banco, () =>
      servicio.registrar(alta({ institucionId: institucionY })),
    );

    expect(resultado).toEqual({ resultado: 'duplicidad' });
    expect(await contar('membresia')).toBe(1);
    expect(await contar('alerta_duplicidad')).toBe(1);
    // Repetir no abre otra.
    await en(banco, () => servicio.registrar(alta({ institucionId: institucionY })));
    expect(await contar('alerta_duplicidad')).toBe(1);
  });

  it('dos altas simultáneas de la misma persona: una crea y la otra recibe RegistroSimultaneo o ya_activa', async () => {
    const resultados = await Promise.allSettled([
      en(banco, () => servicio.registrar(alta())),
      en(banco, () => servicio.registrar(alta())),
    ]);

    expect(await contar('persona')).toBe(1);
    expect(await contar('membresia')).toBe(1);
    for (const r of resultados) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(RegistroSimultaneo);
    }
  });

  it('la búsqueda devuelve la ficha y deja la lectura en auditoría sin el documento', async () => {
    await en(banco, () =>
      servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      ),
    );

    const ficha = await en(banco, () => servicio.buscarPorDocumento('1077000002'));

    expect(ficha.persona).toMatchObject({ nombres: 'Sofía', fechaNacimiento: '2019-04-04' });
    expect(ficha.beneficiario?.membresiaActiva?.institucionId).toBe(institucionX);
    expect(ficha.beneficiario?.representantes).toEqual([
      { persona: expect.objectContaining({ nombres: 'Luis' }), parentesco: 'padre' },
    ]);

    const lecturas = await admin.$queryRaw<{ entidad_id: string; detalle: { cantidad: number } }[]>`
      SELECT entidad_id, detalle FROM core.auditoria
      WHERE banco_id = ${banco}::uuid AND accion = 'leer'`;
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0]?.entidad_id).toMatch(/^busqueda_por_documento:/);
    expect(lecturas[0]?.entidad_id).not.toContain('1077000002');
    expect(lecturas[0]?.detalle.cantidad).toBe(2);
  });

  it('una búsqueda sin resultado también queda en auditoría', async () => {
    const ficha = await en(banco, () => servicio.buscarPorDocumento('1077999999'));
    expect(ficha).toEqual({ persona: null, beneficiario: null });
    const [lectura] = await admin.$queryRaw<{ entidad_id: string }[]>`
      SELECT entidad_id FROM core.auditoria WHERE banco_id = ${banco}::uuid AND accion = 'leer'`;
    expect(lectura?.entidad_id).toBe('busqueda_por_documento');
  });

  it('otro banco no encuentra a la persona', async () => {
    await en(banco, () => servicio.registrar(alta()));
    const ficha = await en(otroBanco, () => servicio.buscarPorDocumento('1077000001'));
    expect(ficha.persona).toBeNull();
  });
});
