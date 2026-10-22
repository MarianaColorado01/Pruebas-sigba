import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AVISO_DE_PRIVACIDAD,
  PARENTESCOS,
  type Parentesco,
  SEXOS,
  type Sexo,
  TIPOS_DE_DOCUMENTO,
  type TipoDeDocumento,
} from '@sigba/shared-types';
import { membresiaActivada } from '../events/membresias.js';
import {
  type DatosDePersona,
  type FichaDeBeneficiario,
  type Membresia,
  RegistroRepositorio,
  type TransaccionDeRegistro,
} from './registro.js';

/** Como llega del DTO: tipos comprobados, contenido sin validar. */
export interface PersonaRecibida {
  tipoDocumento: TipoDeDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  sexo: Sexo;
  fechaNacimiento: string;
  telefono?: string | null;
  direccion?: string | null;
}

export interface AltaDeBeneficiario {
  institucionId: string;
  tipoPoblacionId: string;
  persona: PersonaRecibida;
  representantes?: { persona: PersonaRecibida; parentesco: Parentesco }[];
  consentimiento: { otorgado: boolean; versionAviso: string };
}

export type ResultadoDeAlta =
  | { resultado: 'creada' | 'ya_activa'; personaId: string; membresia: Membresia }
  | { resultado: 'duplicidad' }
  | { resultado: 'tipo_distinto' };

const MAYORIA_DE_EDAD = 18;
const LARGO_DOCUMENTO = 20;
const LARGO_NOMBRE = 100;
const LARGO_TELEFONO = 30;
const LARGO_DIRECCION = 500;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENTO = /^[0-9A-Z]+$/;

/**
 * Quita puntos, guiones y espacios y pasa a mayúsculas: «1.088.123.456» y
 * `1088123456` son el mismo documento (sección 7.1 del esquema).
 */
export function normalizarDocumento(numero: string): string {
  return numero.replace(/[.\-\s]/g, '').toUpperCase();
}

/** La fecha de hoy en Colombia, AAAA-MM-DD: la edad se cuenta con la hora local. */
function hoy(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

/** Años cumplidos en `fecha` de quien nació en `nacimiento`, las dos AAAA-MM-DD. */
export function edad(nacimiento: string, fecha: string): number {
  const anios = Number(fecha.slice(0, 4)) - Number(nacimiento.slice(0, 4));
  return fecha.slice(5) < nacimiento.slice(5) ? anios - 1 : anios;
}

function esMenor(nacimiento: string): boolean {
  return edad(nacimiento, hoy()) < MAYORIA_DE_EDAD;
}

/**
 * Registro nominal de beneficiarios (SBA-27, RF-M2-04 a RF-M2-06) y la regla
 * de una sola membresía activa (SBA-28, RF-M2-07). Esquema v5.0, sección 7.
 *
 * Los mensajes de error nunca llevan datos de la persona ni nombran la otra
 * institución (Arquitectura 8.6, RNF-M2-05).
 */
@Injectable()
export class RegistroDeBeneficiariosService {
  constructor(private readonly repositorio: RegistroRepositorio) {}

  async buscarPorDocumento(numeroDocumento: string): Promise<FichaDeBeneficiario> {
    return this.repositorio.fichaPorDocumento(documentoValido(numeroDocumento, 'El documento'));
  }

  async registrar(alta: AltaDeBeneficiario): Promise<ResultadoDeAlta> {
    if (alta.consentimiento.otorgado !== true) {
      throw new BadRequestException('Sin consentimiento no se registra a la persona.');
    }
    if (alta.consentimiento.versionAviso !== AVISO_DE_PRIVACIDAD.version) {
      throw new BadRequestException(
        'El aviso de privacidad que se mostró no es el vigente. Recarga el formulario.',
      );
    }
    const titular = personaValida(alta.persona, 'La persona');
    const representantes = (alta.representantes ?? []).map((r, i) => {
      const quien = `El representante ${i + 1}`;
      if (!(PARENTESCOS as readonly string[]).includes(r.parentesco)) {
        throw new BadRequestException(`${quien}: parentesco desconocido.`);
      }
      return { persona: personaValida(r.persona, quien), parentesco: r.parentesco };
    });
    const documentos = new Set([
      titular.numeroDocumento,
      ...representantes.map((r) => r.persona.numeroDocumento),
    ]);
    if (documentos.size !== representantes.length + 1) {
      throw new BadRequestException(
        'Un documento viene repetido entre la persona y sus representantes.',
      );
    }

    return this.repositorio.enTransaccion((tx) => this.alta(tx, alta, titular, representantes));
  }

  /** Pasos 1 a 7 de la sección 7.2 del esquema, en una sola transacción. */
  private async alta(
    tx: TransaccionDeRegistro,
    { institucionId, tipoPoblacionId }: AltaDeBeneficiario,
    titular: DatosDePersona,
    representantes: { persona: DatosDePersona; parentesco: Parentesco }[],
  ): Promise<ResultadoDeAlta> {
    if (!(await tx.institucionActiva(institucionId))) {
      throw new NotFoundException('No existe esa institución o está desactivada.');
    }

    const existente = await tx.personaPorDocumento(titular.numeroDocumento);
    if (existente && existente.tipoDocumento !== titular.tipoDocumento) {
      return { resultado: 'tipo_distinto' };
    }

    // Antes de mirar a los representantes, para que nada en ellos evite la
    // alerta; y antes de insertar, no después del UNIQUE: tras ese error la
    // transacción queda abortada y la alerta no se podría escribir (paso 3).
    if (existente?.esBeneficiaria) {
      const activa = await tx.membresiaActiva(existente.id);
      if (activa?.institucionId === institucionId) {
        return { resultado: 'ya_activa', personaId: existente.id, membresia: activa };
      }
      if (activa) {
        await tx.abrirAlerta(existente.id, institucionId, activa.id);
        return { resultado: 'duplicidad' };
      }
    }

    const representantesExistentes = [];
    for (const { persona } of representantes) {
      const guardado = await tx.personaPorDocumento(persona.numeroDocumento);
      if (guardado && guardado.tipoDocumento !== persona.tipoDocumento) {
        return { resultado: 'tipo_distinto' };
      }
      // La fecha guardada manda sobre la recibida: la persona no se edita aquí.
      if (esMenor(guardado?.fechaNacimiento ?? persona.fechaNacimiento)) {
        throw new BadRequestException('Un representante tiene que ser mayor de edad.');
      }
      representantesExistentes.push(guardado);
    }

    const menor = esMenor(existente?.fechaNacimiento ?? titular.fechaNacimiento);
    if (!menor && representantes.length > 0) {
      throw new BadRequestException('Solo un menor de edad lleva representante.');
    }

    const personaId = existente?.id ?? (await tx.crearPersona(titular));
    // Quien ya es beneficiaria conserva su tipo de población: el alta no lo
    // cambia y `tipoPoblacionId` se ignora.
    if (!existente?.esBeneficiaria) {
      if (!(await tx.tipoDePoblacionActivo(tipoPoblacionId))) {
        throw new NotFoundException('No existe ese tipo de población o está desactivado.');
      }
      await tx.crearBeneficiario(personaId, tipoPoblacionId);
    }

    const vigentes = existente?.esBeneficiaria ? await tx.representantesVigentes(personaId) : [];
    const nuevos: string[] = [];
    for (const [i, { persona, parentesco }] of representantes.entries()) {
      const guardado = representantesExistentes[i];
      const representanteId = guardado?.id ?? (await tx.crearPersona(persona));
      // Un representante nuevo firma su propio consentimiento (D48).
      if (!guardado) await tx.crearConsentimiento(representanteId, null, AVISO_DE_PRIVACIDAD);
      if (!vigentes.includes(representanteId)) {
        await tx.crearRepresentacion(personaId, representanteId, parentesco);
      }
      nuevos.push(representanteId);
    }

    const otorgante = menor ? (nuevos[0] ?? vigentes[0]) : null;
    if (menor && !otorgante) {
      throw new BadRequestException('Un menor de edad necesita un representante adulto.');
    }
    await tx.crearConsentimiento(personaId, otorgante ?? null, AVISO_DE_PRIVACIDAD);

    const membresia = await tx.crearMembresia(personaId, institucionId);
    await tx.emitir(membresiaActivada(membresia));
    return { resultado: 'creada', personaId, membresia };
  }
}

function documentoValido(numero: string, quien: string): string {
  const normalizado = normalizarDocumento(numero ?? '');
  if (!normalizado || normalizado.length > LARGO_DOCUMENTO || !DOCUMENTO.test(normalizado)) {
    throw new BadRequestException(
      `${quien}: el número de documento solo admite dígitos y letras, hasta ${LARGO_DOCUMENTO}.`,
    );
  }
  return normalizado;
}

function personaValida(persona: PersonaRecibida, quien: string): DatosDePersona {
  if (!(TIPOS_DE_DOCUMENTO as readonly string[]).includes(persona.tipoDocumento)) {
    throw new BadRequestException(`${quien}: tipo de documento desconocido.`);
  }
  if (!(SEXOS as readonly string[]).includes(persona.sexo)) {
    throw new BadRequestException(`${quien}: sexo desconocido.`);
  }
  return {
    tipoDocumento: persona.tipoDocumento,
    numeroDocumento: documentoValido(persona.numeroDocumento, quien),
    nombres: textoObligatorio(persona.nombres, LARGO_NOMBRE, `${quien}: los nombres`),
    apellidos: textoObligatorio(persona.apellidos, LARGO_NOMBRE, `${quien}: los apellidos`),
    sexo: persona.sexo,
    fechaNacimiento: fechaDeNacimiento(persona.fechaNacimiento, quien),
    telefono: textoOpcional(persona.telefono, LARGO_TELEFONO, `${quien}: el teléfono`),
    direccion: textoOpcional(persona.direccion, LARGO_DIRECCION, `${quien}: la dirección`),
  };
}

function textoObligatorio(texto: string, largo: number, campo: string): string {
  const limpio = textoOpcional(texto, largo, campo);
  if (!limpio) throw new BadRequestException(`${campo} son obligatorios.`);
  return limpio;
}

function textoOpcional(texto: string | null | undefined, largo: number, campo: string) {
  const limpio = texto?.trim() || null;
  if (limpio && limpio.length > largo) {
    throw new BadRequestException(`${campo} no puede pasar de ${largo} caracteres.`);
  }
  return limpio;
}

/** AAAA-MM-DD, una fecha que existe y no posterior a hoy. */
function fechaDeNacimiento(fecha: string, quien: string): string {
  const instante = FECHA.test(fecha ?? '') ? Date.parse(`${fecha}T00:00Z`) : NaN;
  const existe = !Number.isNaN(instante) && new Date(instante).toISOString().startsWith(fecha);
  if (!existe || fecha > hoy()) {
    throw new BadRequestException(`${quien}: la fecha de nacimiento no es válida (AAAA-MM-DD).`);
  }
  return fecha;
}
