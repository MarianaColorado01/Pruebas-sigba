import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { PrismaClient } from '@prisma/client';
import { AVISO_DE_PRIVACIDAD } from '@sigba/shared-types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../src/core/auditoria/audit.service.js';
import { OutboxService } from '../src/core/outbox/outbox.service.js';
import { type PrismaService, runWithTenantContext } from '../src/core/database/index.js';
import { RegistroPrismaRepositorio } from '../src/modules/beneficiarios/repositories/registro.prisma.repositorio.js';
import {
  type AltaDeBeneficiario,
  RegistroDeBeneficiariosService,
} from '../src/modules/beneficiarios/services/registro-de-beneficiarios.service.js';
import { MembresiasService } from '../src/modules/beneficiarios/services/membresias.service.js';
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
  let membresias: MembresiasService;

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

  async function eventos(): Promise<{ tipo: string; version: number; payload: object }[]> {
    return admin.$queryRaw`
      SELECT tipo, version, payload FROM core.outbox
      WHERE banco_id = ${banco}::uuid ORDER BY ocurrido_en, tipo DESC`;
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
    const repositorio = new RegistroPrismaRepositorio(
      app as PrismaService,
      new AuditService(),
      new OutboxService(),
    );
    servicio = new RegistroDeBeneficiariosService(repositorio);
    membresias = new MembresiasService(repositorio);
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

  describe('membresías y outbox (SBA-28)', () => {
    const contratos = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../docs/eventos/contratos.v1.json', import.meta.url)),
        'utf8',
      ),
    ) as { $id: string };
    const ajv = new Ajv2020();
    ajv.addSchema(contratos);
    const cumpleContrato = (evento: { tipo: string }) =>
      ajv.getSchema(`${contratos.$id}#/$defs/${evento.tipo}_v1`)?.(evento);

    it('el alta deja MembresiaActivada en el outbox, con el contrato v1 y sin datos personales', async () => {
      await en(banco, () => servicio.registrar(alta()));

      const [evento, ...otros] = await eventos();
      expect(otros).toHaveLength(0);
      expect(evento?.tipo).toBe('MembresiaActivada');
      expect(cumpleContrato(evento as { tipo: string })).toBe(true);
      expect(JSON.stringify(evento)).not.toMatch(/1077000001|Ana|Sintética/);
    });

    it('una duplicidad no deja evento de membresía', async () => {
      await en(banco, () => servicio.registrar(alta()));
      await en(banco, () => servicio.registrar(alta({ institucionId: institucionY })));
      expect((await eventos()).map((e) => e.tipo)).toEqual(['MembresiaActivada']);
    });

    it('el traslado cierra A con motivo y fecha, abre B y emite los dos eventos (criterio 2)', async () => {
      const creada = await en(banco, () => servicio.registrar(alta()));
      const { personaId } = creada as { personaId: string };

      const nueva = await en(banco, () => membresias.trasladar(personaId, institucionY));

      const filas = await admin.$queryRaw<
        {
          institucion_id: string;
          fin_en: Date | null;
          motivo_fin: string | null;
          cerrado_por: string | null;
        }[]
      >`SELECT institucion_id::text, fin_en, motivo_fin::text, cerrado_por
        FROM beneficiarios.membresia WHERE banco_id = ${banco}::uuid ORDER BY inicio_en, fin_en NULLS LAST`;
      expect(filas).toEqual([
        {
          institucion_id: institucionX,
          fin_en: expect.any(Date),
          motivo_fin: 'traslado',
          cerrado_por: actor,
        },
        { institucion_id: institucionY, fin_en: null, motivo_fin: null, cerrado_por: null },
      ]);
      expect(nueva.institucionId).toBe(institucionY);
      // Las dos fechas salen del now() de la base en la misma transacción.
      expect(filas[0]?.fin_en).toEqual(nueva.inicioEn);
      const emitidos = await eventos();
      expect(emitidos.map((e) => e.tipo).sort()).toEqual(
        ['MembresiaActivada', 'MembresiaActivada', 'MembresiaCerrada'].sort(),
      );
      for (const evento of emitidos) expect(cumpleContrato(evento)).toBe(true);
    });

    it('un traslado que falla a mitad no deja la membresía cerrada ni eventos', async () => {
      const { personaId } = (await en(banco, () => servicio.registrar(alta()))) as {
        personaId: string;
      };
      // Simula una falla después del cierre: la segunda membresía activa choca.
      const repositorio = new RegistroPrismaRepositorio(
        app as PrismaService,
        new AuditService(),
        new OutboxService(),
      );
      await expect(
        en(banco, () =>
          repositorio.enTransaccion(async (tx) => {
            const activa = await tx.membresiaActiva(personaId);
            await tx.cerrarMembresia(activa?.id as string, 'traslado');
            await tx.emitir({
              tipo: 'MembresiaCerrada',
              version: 1,
              payload: {
                membresiaId: activa?.id as string,
                beneficiarioId: personaId,
                institucionId: institucionX,
              },
            });
            throw new Error('falla simulada');
          }),
        ),
      ).rejects.toThrow('falla simulada');

      const [activa] = await admin.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM beneficiarios.membresia WHERE banco_id = ${banco}::uuid AND fin_en IS NULL`;
      expect(Number(activa?.n)).toBe(1);
      expect(await eventos()).toHaveLength(1);
    });

    it('cerrar y volver: el historial conserva las dos y la lectura queda en auditoría (criterio 3)', async () => {
      const creada = (await en(banco, () => servicio.registrar(alta()))) as {
        personaId: string;
        membresia: { id: string };
      };
      await en(banco, () => membresias.cerrar(creada.membresia.id, 'dejo_de_asistir'));
      await en(banco, () => servicio.registrar(alta()));

      const historial = await en(banco, () => membresias.historial(creada.personaId));

      expect(historial.map((m) => m.motivoFin)).toEqual([null, 'dejo_de_asistir']);
      const [lectura] = await admin.$queryRaw<{ entidad_id: string }[]>`
        SELECT entidad_id FROM core.auditoria
        WHERE banco_id = ${banco}::uuid AND accion = 'leer' AND entidad = 'membresia'`;
      expect(lectura?.entidad_id).toBe(`historial_de_membresias:${creada.personaId}`);
      expect((await eventos()).map((e) => e.tipo)).toEqual([
        'MembresiaActivada',
        'MembresiaCerrada',
        'MembresiaActivada',
      ]);
    });

    it('otro banco no cierra la membresía', async () => {
      const creada = (await en(banco, () => servicio.registrar(alta()))) as {
        membresia: { id: string };
      };
      await expect(
        en(otroBanco, () => membresias.cerrar(creada.membresia.id, 'otro')),
      ).rejects.toThrow('No hay una membresía activa');
    });
  });
});
