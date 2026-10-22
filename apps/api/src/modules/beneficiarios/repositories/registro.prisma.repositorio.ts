import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Parentesco } from '@sigba/shared-types';
import {
  AuditService,
  executeTransactionWithTenant,
  OutboxService,
  PrismaService,
} from '../../../core/index.js';
import { contextoDeEscritura } from './contexto-de-tenant.js';
import {
  type Aviso,
  type DatosDePersona,
  type FichaDeBeneficiario,
  type Membresia,
  type Persona,
  RegistroRepositorio,
  RegistroSimultaneo,
  type TransaccionDeRegistro,
} from '../services/registro.js';

const UNICIDAD_VIOLADA = 'P2002';

/** Finalidad de las lecturas de datos personales del registro (RNF-M2-09). */
const FINALIDAD_DEL_REGISTRO = 'registro_de_beneficiario';

/**
 * Columnas del documento. Mientras los datos sean sintéticos el número va en
 * claro (AGENTS.md, ADR-15). SBA-31 cambia estas dos funciones y la columna:
 * `aColumnas` cifra y calcula el HMAC por banco, `deColumnas` descifra y la
 * búsqueda va por `documentoHmac`. El resto del adaptador no ve el número.
 */
function aColumnas(numeroDocumento: string) {
  return { numeroDocumento };
}
function deColumnas(fila: { numeroDocumento: string }): string {
  return fila.numeroDocumento;
}

const COLUMNAS_PERSONA = {
  id: true,
  tipoDocumento: true,
  numeroDocumento: true,
  nombres: true,
  apellidos: true,
  sexo: true,
  fechaNacimiento: true,
  telefono: true,
  direccion: true,
} satisfies Prisma.PersonaSelect;

const COLUMNAS_MEMBRESIA = {
  id: true,
  beneficiarioId: true,
  institucionId: true,
  inicioEn: true,
  finEn: true,
  motivoFin: true,
} satisfies Prisma.MembresiaSelect;

function aPersona(fila: Prisma.PersonaGetPayload<{ select: typeof COLUMNAS_PERSONA }>): Persona {
  return {
    ...fila,
    numeroDocumento: deColumnas(fila),
    fechaNacimiento: aFecha(fila.fechaNacimiento),
  };
}

/** `@db.Date` llega como medianoche UTC. */
function aFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Adaptador de Prisma del registro nominal. Cada alta corre en una sola
 * `executeTransactionWithTenant` y todas las operaciones usan su `tx`, con la
 * auditoría de cada fila creada: persona, beneficiario, representación,
 * consentimiento, membresía y alerta confirman o revierten juntas (ADR-08,
 * ADR-09). Es el patrón de recepciones mientras llega SBA-67.
 */
@Injectable()
export class RegistroPrismaRepositorio extends RegistroRepositorio {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditService,
    private readonly outbox: OutboxService,
  ) {
    super();
  }

  async enTransaccion<R>(fn: (tx: TransaccionDeRegistro) => Promise<R>): Promise<R> {
    const { bancoId, actor } = contextoDeEscritura();
    try {
      return await executeTransactionWithTenant<R>(this.prisma, (tx) =>
        fn(this.operaciones(tx, bancoId, actor)),
      );
    } catch (error) {
      // Dos altas simultáneas pasaron la consulta previa y la segunda chocó con
      // el UNIQUE de persona o de membresía activa: se revirtió entera.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNICIDAD_VIOLADA
      ) {
        throw new RegistroSimultaneo();
      }
      throw error;
    }
  }

  private operaciones(
    tx: Prisma.TransactionClient,
    bancoId: string,
    actor: string,
  ): TransaccionDeRegistro {
    const auditar = (entidad: string, entidadId: string) =>
      this.auditoria.registrar(tx, { accion: 'crear', entidad, entidadId });

    return {
      institucionActiva: async (id) =>
        (await tx.institucion.count({ where: { id, activa: true } })) > 0,

      tipoDePoblacionActivo: async (id) =>
        (await tx.tipoPoblacion.count({ where: { id, activo: true } })) > 0,

      personaPorDocumento: async (numeroDocumento) => {
        const fila = await tx.persona.findUnique({
          where: { bancoId_numeroDocumento: { bancoId, ...aColumnas(numeroDocumento) } },
          select: {
            id: true,
            tipoDocumento: true,
            fechaNacimiento: true,
            beneficiario: { select: { personaId: true } },
          },
        });
        return fila
          ? {
              id: fila.id,
              tipoDocumento: fila.tipoDocumento,
              fechaNacimiento: aFecha(fila.fechaNacimiento),
              esBeneficiaria: fila.beneficiario !== null,
            }
          : null;
      },

      crearPersona: async ({ numeroDocumento, fechaNacimiento, ...datos }: DatosDePersona) => {
        const { id } = await tx.persona.create({
          data: {
            ...datos,
            ...aColumnas(numeroDocumento),
            bancoId,
            fechaNacimiento: new Date(`${fechaNacimiento}T00:00:00Z`),
          },
          select: { id: true },
        });
        await auditar('persona', id);
        return id;
      },

      crearBeneficiario: async (personaId, tipoPoblacionId) => {
        await tx.beneficiario.create({ data: { personaId, bancoId, tipoPoblacionId } });
        await auditar('beneficiario', personaId);
      },

      representantesVigentes: async (beneficiarioId) =>
        (
          await tx.representacion.findMany({
            where: { beneficiarioId, finEn: null },
            orderBy: { inicioEn: 'asc' },
            select: { representantePersonaId: true },
          })
        ).map((r) => r.representantePersonaId),

      crearRepresentacion: async (beneficiarioId, representanteId, parentesco: Parentesco) => {
        const { id } = await tx.representacion.create({
          data: { bancoId, beneficiarioId, representantePersonaId: representanteId, parentesco },
          select: { id: true },
        });
        await auditar('representacion', id);
      },

      crearConsentimiento: async (personaId, otorganteId, aviso: Aviso) => {
        const { id } = await tx.consentimiento.create({
          data: {
            bancoId,
            personaId,
            otorgantePersonaId: otorganteId,
            recogidoPor: actor,
            versionAviso: aviso.version,
            finalidad: aviso.finalidad,
          },
          select: { id: true },
        });
        await auditar('consentimiento', id);
      },

      membresiaActiva: (beneficiarioId) =>
        tx.membresia.findFirst({
          where: { beneficiarioId, finEn: null },
          select: COLUMNAS_MEMBRESIA,
        }),

      crearMembresia: async (beneficiarioId, institucionId): Promise<Membresia> => {
        const membresia = await tx.membresia.create({
          data: { bancoId, beneficiarioId, institucionId, creadoPor: actor },
          select: COLUMNAS_MEMBRESIA,
        });
        await auditar('membresia', membresia.id);
        return membresia;
      },

      cerrarMembresia: async (id, motivoFin) => {
        // El fin sale del reloj de la base, como el inicio: con el de la API,
        // un desfase entre los dos haría fallar membresia_fin_despues_de_inicio.
        // Con RLS, un id de otro banco o ya cerrado es cero filas.
        const cerradas = await tx.$executeRaw`
          UPDATE beneficiarios.membresia
          SET fin_en = now(),
              motivo_fin = ${motivoFin}::beneficiarios.motivo_fin_membresia,
              cerrado_por = ${actor}
          WHERE id = ${id}::uuid AND fin_en IS NULL`;
        if (cerradas === 0) return null;
        await this.auditoria.registrar(tx, {
          accion: 'actualizar',
          entidad: 'membresia',
          entidadId: id,
          detalle: { camposModificados: ['fin_en', 'motivo_fin', 'cerrado_por'] },
        });
        return tx.membresia.findUniqueOrThrow({ where: { id }, select: COLUMNAS_MEMBRESIA });
      },

      emitir: async (evento) => {
        await this.outbox.emitir(tx, evento);
      },

      abrirAlerta: async (beneficiarioId, institucionId, membresiaVigenteId) => {
        // ON CONFLICT sobre el UNIQUE parcial: un error de UNIQUE dejaría la
        // transacción abortada (sección 7.2, paso 6).
        const [fila] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO beneficiarios.alerta_duplicidad
            (banco_id, beneficiario_id, institucion_solicitante_id, membresia_vigente_id, creado_por)
          VALUES (${bancoId}::uuid, ${beneficiarioId}::uuid, ${institucionId}::uuid,
                  ${membresiaVigenteId}::uuid, ${actor})
          ON CONFLICT (beneficiario_id, institucion_solicitante_id) WHERE estado = 'abierta'
          DO NOTHING
          RETURNING id::text`;
        if (!fila) return null;
        await auditar('alerta_duplicidad', fila.id);
        return fila.id;
      },
    };
  }

  async fichaPorDocumento(numeroDocumento: string): Promise<FichaDeBeneficiario> {
    return executeTransactionWithTenant<FichaDeBeneficiario>(this.prisma, async (tx) => {
      const { bancoId } = contextoDeEscritura();
      const fila = await tx.persona.findUnique({
        where: { bancoId_numeroDocumento: { bancoId, ...aColumnas(numeroDocumento) } },
        select: {
          ...COLUMNAS_PERSONA,
          beneficiario: {
            select: {
              tipoPoblacionId: true,
              membresias: { where: { finEn: null }, select: COLUMNAS_MEMBRESIA },
              representaciones: {
                where: { finEn: null },
                orderBy: { inicioEn: 'asc' },
                select: { parentesco: true, representante: { select: COLUMNAS_PERSONA } },
              },
            },
          },
        },
      });

      const ficha: FichaDeBeneficiario = fila
        ? {
            persona: aPersona(fila),
            beneficiario: fila.beneficiario && {
              tipoPoblacionId: fila.beneficiario.tipoPoblacionId,
              membresiaActiva: fila.beneficiario.membresias[0] ?? null,
              representantes: fila.beneficiario.representaciones.map((r) => ({
                persona: aPersona(r.representante),
                parentesco: r.parentesco,
              })),
            },
          }
        : { persona: null, beneficiario: null };

      // Qué se leyó y cuántas personas, nunca el documento buscado (Arquitectura 8.6).
      const leidas = ficha.persona
        ? [ficha.persona.id, ...(ficha.beneficiario?.representantes ?? []).map((r) => r.persona.id)]
        : [];
      await this.auditoria.registrarLectura(tx, {
        entidad: 'persona',
        conjunto: ['busqueda_por_documento', ...leidas].join(':'),
        cantidad: leidas.length,
        finalidad: FINALIDAD_DEL_REGISTRO,
      });
      return ficha;
    });
  }

  async historial(beneficiarioId: string): Promise<Membresia[] | null> {
    return executeTransactionWithTenant<Membresia[] | null>(this.prisma, async (tx) => {
      const beneficiario = await tx.beneficiario.findUnique({
        where: { personaId: beneficiarioId },
        select: {
          membresias: { orderBy: { inicioEn: 'desc' }, select: COLUMNAS_MEMBRESIA },
        },
      });
      if (!beneficiario) return null;
      // Dónde recibió ayuda y por qué se fue también es dato de la persona.
      await this.auditoria.registrarLectura(tx, {
        entidad: 'membresia',
        conjunto: `historial_de_membresias:${beneficiarioId}`,
        cantidad: beneficiario.membresias.length,
        finalidad: FINALIDAD_DEL_REGISTRO,
      });
      return beneficiario.membresias;
    });
  }
}
