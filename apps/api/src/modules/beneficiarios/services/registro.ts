/**
 * Registro nominal: tipos y el puerto por el que se guarda (SBA-27, SBA-28).
 *
 * El alta escribe persona, beneficiario, representación, consentimiento,
 * membresía, alerta y auditoría en una sola transacción. El service decide y
 * el adaptador de `repositories/` ejecuta cada paso con el mismo cliente
 * transaccional: `RegistroRepositorio.enTransaccion` abre la transacción y le
 * pasa al service las operaciones. Cuando `core` tenga la transacción abierta
 * por el service (SBA-67), cambia solo el adaptador.
 *
 * Nada de esto va a logs, a eventos ni a mensajes de error (Arquitectura 8.6).
 */

import type { MotivoFinDeMembresia, Parentesco, Sexo, TipoDeDocumento } from '@sigba/shared-types';
import type { EventoDeMembresia } from '../events/membresias.js';

/** Datos de una persona ya validados y normalizados. */
export interface DatosDePersona {
  tipoDocumento: TipoDeDocumento;
  /** Solo dígitos y mayúsculas (CHECK de `persona.numero_documento`). */
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  sexo: Sexo;
  /** AAAA-MM-DD. */
  fechaNacimiento: string;
  telefono: string | null;
  direccion: string | null;
}

export interface Persona extends DatosDePersona {
  id: string;
}

/** Lo que el alta necesita saber de una persona que ya existe. */
export interface PersonaExistente {
  id: string;
  tipoDocumento: TipoDeDocumento;
  fechaNacimiento: string;
  esBeneficiaria: boolean;
}

export interface Membresia {
  id: string;
  beneficiarioId: string;
  institucionId: string;
  inicioEn: Date;
  finEn: Date | null;
  motivoFin: MotivoFinDeMembresia | null;
}

export interface Representante {
  persona: Persona;
  parentesco: Parentesco;
}

export interface FichaDeBeneficiario {
  persona: Persona | null;
  beneficiario: {
    tipoPoblacionId: string;
    membresiaActiva: Membresia | null;
    representantes: Representante[];
  } | null;
}

export interface Aviso {
  version: string;
  finalidad: string;
}

/** Persona que representa hoy a un beneficiario. El documento, normalizado. */
export interface RepresentanteVigente {
  id: string;
  numeroDocumento: string;
}

/**
 * Operaciones dentro de la transacción del alta. Todas usan el mismo cliente:
 * si una falla, no queda nada.
 */
export interface TransaccionDeRegistro {
  institucionActiva(institucionId: string): Promise<boolean>;
  tipoDePoblacionActivo(tipoPoblacionId: string): Promise<boolean>;
  personaPorDocumento(numeroDocumento: string): Promise<PersonaExistente | null>;
  crearPersona(datos: DatosDePersona): Promise<string>;
  crearBeneficiario(personaId: string, tipoPoblacionId: string): Promise<void>;
  /** Los representantes vigentes del beneficiario, del más antiguo al más reciente. */
  representantesVigentes(beneficiarioId: string): Promise<RepresentanteVigente[]>;
  crearRepresentacion(
    beneficiarioId: string,
    representanteId: string,
    parentesco: Parentesco,
  ): Promise<void>;
  /** `otorganteId` nulo: autoriza el titular. */
  crearConsentimiento(personaId: string, otorganteId: string | null, aviso: Aviso): Promise<void>;
  membresiaActiva(beneficiarioId: string): Promise<Membresia | null>;
  crearMembresia(beneficiarioId: string, institucionId: string): Promise<Membresia>;
  /**
   * Cierra la membresía si sigue activa, con fecha de hoy y quién la cerró.
   * Devuelve `null` si no existe en el banco o ya estaba cerrada: una cerrada
   * no se reabre.
   */
  cerrarMembresia(membresiaId: string, motivo: MotivoFinDeMembresia): Promise<Membresia | null>;
  /** Al outbox, con el mismo cliente: el evento confirma con la escritura (ADR-09). */
  emitir(evento: EventoDeMembresia): Promise<void>;
  /**
   * Abre la alerta si no hay otra abierta para la misma persona e institución.
   * Devuelve su id, o `null` si ya estaba abierta.
   */
  abrirAlerta(
    beneficiarioId: string,
    institucionId: string,
    membresiaVigenteId: string,
  ): Promise<string | null>;
}

/** Otra alta de la misma persona confirmó primero (UNIQUE de persona o membresía). */
export class RegistroSimultaneo extends Error {}

export abstract class RegistroRepositorio {
  /** @throws RegistroSimultaneo */
  abstract enTransaccion<R>(fn: (tx: TransaccionDeRegistro) => Promise<R>): Promise<R>;

  /** Busca por documento y deja la lectura en auditoría (RNF-M2-09). */
  abstract fichaPorDocumento(numeroDocumento: string): Promise<FichaDeBeneficiario>;

  /**
   * Membresías del beneficiario, de la más reciente a la más antigua, con la
   * lectura en auditoría. `null` si el beneficiario no existe en el banco.
   */
  abstract historial(beneficiarioId: string): Promise<Membresia[] | null>;
}
