import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AVISO_DE_PRIVACIDAD } from '@sigba/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AltaDeBeneficiario,
  edad,
  normalizarDocumento,
  type PersonaRecibida,
  RegistroDeBeneficiariosService,
} from './registro-de-beneficiarios.service.js';
import {
  type DatosDePersona,
  type FichaDeBeneficiario,
  type Membresia,
  RegistroRepositorio,
  type TransaccionDeRegistro,
} from './registro.js';

const institucionX = '11111111-1111-4111-8111-111111111111';
const institucionY = '22222222-2222-4222-8222-222222222222';
const poblacion = '33333333-3333-4333-8333-333333333333';

/** Datos sintéticos. */
const adulta: PersonaRecibida = {
  tipoDocumento: 'cc',
  numeroDocumento: '1.088.000.001',
  nombres: ' Ana ',
  apellidos: 'Sintética',
  sexo: 'femenino',
  fechaNacimiento: '1980-01-01',
};
const menor: PersonaRecibida = {
  tipoDocumento: 'ti',
  numeroDocumento: '1088000002',
  nombres: 'Sofía',
  apellidos: 'Sintética',
  sexo: 'femenino',
  fechaNacimiento: '2016-05-05',
};
const padre: PersonaRecibida = {
  tipoDocumento: 'cc',
  numeroDocumento: '1088000003',
  nombres: 'Luis',
  apellidos: 'Sintético',
  sexo: 'masculino',
  fechaNacimiento: '1985-03-03',
};

function alta(sobrescribir: Partial<AltaDeBeneficiario> = {}): AltaDeBeneficiario {
  return {
    institucionId: institucionX,
    tipoPoblacionId: poblacion,
    persona: adulta,
    consentimiento: { otorgado: true, versionAviso: AVISO_DE_PRIVACIDAD.version },
    ...sobrescribir,
  };
}

interface PersonaGuardada extends DatosDePersona {
  id: string;
  tipoPoblacionId?: string;
}

/** La base en memoria: lo que el adaptador haría con Prisma, sin reglas. */
class BaseFalsa implements TransaccionDeRegistro {
  personas: PersonaGuardada[] = [];
  representaciones: { beneficiarioId: string; representanteId: string; parentesco: string }[] = [];
  consentimientos: { personaId: string; otorganteId: string | null; version: string }[] = [];
  membresias: Membresia[] = [];
  alertas: { beneficiarioId: string; institucionId: string; membresiaVigenteId: string }[] = [];
  institucionesActivas = new Set([institucionX, institucionY]);
  private siguiente = 0;

  async institucionActiva(id: string) {
    return this.institucionesActivas.has(id);
  }
  async tipoDePoblacionActivo(id: string) {
    return id === poblacion;
  }
  async personaPorDocumento(numero: string) {
    const p = this.personas.find((x) => x.numeroDocumento === numero);
    return p
      ? {
          id: p.id,
          tipoDocumento: p.tipoDocumento,
          fechaNacimiento: p.fechaNacimiento,
          esBeneficiaria: p.tipoPoblacionId !== undefined,
        }
      : null;
  }
  async crearPersona(datos: DatosDePersona) {
    const id = `persona-${++this.siguiente}`;
    this.personas.push({ ...datos, id });
    return id;
  }
  async crearBeneficiario(personaId: string, tipoPoblacionId: string) {
    const p = this.personas.find((x) => x.id === personaId);
    if (p) p.tipoPoblacionId = tipoPoblacionId;
  }
  async representantesVigentes(beneficiarioId: string) {
    return this.representaciones
      .filter((r) => r.beneficiarioId === beneficiarioId)
      .map((r) => r.representanteId);
  }
  async crearRepresentacion(beneficiarioId: string, representanteId: string, parentesco: string) {
    this.representaciones.push({ beneficiarioId, representanteId, parentesco });
  }
  async crearConsentimiento(
    personaId: string,
    otorganteId: string | null,
    aviso: { version: string },
  ) {
    this.consentimientos.push({ personaId, otorganteId, version: aviso.version });
  }
  async membresiaActiva(beneficiarioId: string) {
    return this.membresias.find((m) => m.beneficiarioId === beneficiarioId && !m.finEn) ?? null;
  }
  async crearMembresia(beneficiarioId: string, institucionId: string) {
    const membresia: Membresia = {
      id: `membresia-${++this.siguiente}`,
      beneficiarioId,
      institucionId,
      inicioEn: new Date(),
      finEn: null,
      motivoFin: null,
    };
    this.membresias.push(membresia);
    return membresia;
  }
  async abrirAlerta(beneficiarioId: string, institucionId: string, membresiaVigenteId: string) {
    const abierta = this.alertas.some(
      (a) => a.beneficiarioId === beneficiarioId && a.institucionId === institucionId,
    );
    if (abierta) return null;
    this.alertas.push({ beneficiarioId, institucionId, membresiaVigenteId });
    return `alerta-${++this.siguiente}`;
  }
}

class RepositorioFalso extends RegistroRepositorio {
  constructor(readonly base: BaseFalsa) {
    super();
  }
  enTransaccion<R>(fn: (tx: TransaccionDeRegistro) => Promise<R>): Promise<R> {
    return fn(this.base);
  }
  fichaPorDocumento = vi.fn(async (): Promise<FichaDeBeneficiario> => ({
    persona: null,
    beneficiario: null,
  }));
}

describe('RegistroDeBeneficiariosService', () => {
  let base: BaseFalsa;
  let repositorio: RepositorioFalso;
  let servicio: RegistroDeBeneficiariosService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
    base = new BaseFalsa();
    repositorio = new RepositorioFalso(base);
    servicio = new RegistroDeBeneficiariosService(repositorio);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('documento y edad', () => {
    it('normaliza puntos, guiones, espacios y minúsculas', () => {
      expect(normalizarDocumento(' 1.088-123 456 ')).toBe('1088123456');
      expect(normalizarDocumento('ab-12')).toBe('AB12');
    });

    it('cuenta los años cumplidos según mes y día', () => {
      expect(edad('2008-10-21', '2026-10-21')).toBe(18);
      expect(edad('2008-10-22', '2026-10-21')).toBe(17);
      expect(edad('2008-02-29', '2026-03-01')).toBe(18);
    });

    it('la búsqueda normaliza el número antes de consultar', async () => {
      await servicio.buscarPorDocumento('1.088.000.001');
      expect(repositorio.fichaPorDocumento).toHaveBeenCalledWith('1088000001');
    });

    it.each(['', '...', '1088*01', '123456789012345678901'])(
      'la búsqueda rechaza %j',
      async (numero) => {
        await expect(servicio.buscarPorDocumento(numero)).rejects.toThrow(BadRequestException);
      },
    );
  });

  describe('alta de una adulta', () => {
    it('crea persona, beneficiario, consentimiento y membresía', async () => {
      const resultado = await servicio.registrar(alta());

      expect(resultado).toMatchObject({ resultado: 'creada', personaId: 'persona-1' });
      expect(base.personas).toEqual([
        expect.objectContaining({
          numeroDocumento: '1088000001',
          nombres: 'Ana',
          telefono: null,
          tipoPoblacionId: poblacion,
        }),
      ]);
      expect(base.consentimientos).toEqual([
        { personaId: 'persona-1', otorganteId: null, version: AVISO_DE_PRIVACIDAD.version },
      ]);
      expect(base.membresias).toHaveLength(1);
    });

    it('sin consentimiento se rechaza sin escribir (SBA-27, criterio 2)', async () => {
      await expect(
        servicio.registrar(
          alta({ consentimiento: { otorgado: false, versionAviso: 'sintetico-0' } }),
        ),
      ).rejects.toThrow('Sin consentimiento');
      expect(base.personas).toHaveLength(0);
    });

    it('con otra versión del aviso se rechaza', async () => {
      await expect(
        servicio.registrar(alta({ consentimiento: { otorgado: true, versionAviso: 'viejo' } })),
      ).rejects.toThrow('aviso de privacidad');
    });

    it('una institución desactivada o de otro banco da 404', async () => {
      base.institucionesActivas.delete(institucionX);
      await expect(servicio.registrar(alta())).rejects.toThrow(NotFoundException);
    });

    it('un tipo de población inexistente da 404 y no deja nada a medias', async () => {
      await expect(
        servicio.registrar(alta({ tipoPoblacionId: '44444444-4444-4444-8444-444444444444' })),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      [{ nombres: '  ' }, 'nombres'],
      [{ apellidos: 'x'.repeat(101) }, 'apellidos'],
      [{ fechaNacimiento: '2026-02-30' }, 'fecha'],
      [{ fechaNacimiento: '2027-01-01' }, 'fecha'],
      [{ numeroDocumento: '10-88/1' }, 'documento'],
      [{ telefono: '3'.repeat(31) }, 'teléfono'],
      [{ tipoDocumento: 'otro' as 'cc' }, 'tipo de documento'],
      [{ sexo: 'x' as 'femenino' }, 'sexo'],
    ])('rechaza %j', async (cambio, campo) => {
      await expect(servicio.registrar(alta({ persona: { ...adulta, ...cambio } }))).rejects.toThrow(
        campo,
      );
    });

    it('una adulta no lleva representante', async () => {
      await expect(
        servicio.registrar(alta({ representantes: [{ persona: padre, parentesco: 'padre' }] })),
      ).rejects.toThrow('Solo un menor');
    });
  });

  describe('persona que ya existe (SBA-27, criterio 1)', () => {
    it('se reutiliza y no se crea otra, aunque el número llegue con puntos', async () => {
      await servicio.registrar(alta());
      base.membresias[0]!.finEn = new Date();

      const resultado = await servicio.registrar(
        alta({ persona: { ...adulta, nombres: 'Otro nombre', numeroDocumento: '1088000001' } }),
      );

      expect(resultado).toMatchObject({ resultado: 'creada', personaId: 'persona-1' });
      expect(base.personas).toHaveLength(1);
      expect(base.personas[0]?.nombres).toBe('Ana');
    });

    it('con otro tipo de documento devuelve tipo_distinto y no escribe nada', async () => {
      await servicio.registrar(alta());
      const antes = base.consentimientos.length;

      const resultado = await servicio.registrar(
        alta({ persona: { ...adulta, tipoDocumento: 'ce' }, institucionId: institucionY }),
      );

      expect(resultado).toEqual({ resultado: 'tipo_distinto' });
      expect(base.consentimientos).toHaveLength(antes);
      expect(base.alertas).toHaveLength(0);
    });

    it('un representante que ya existe como beneficiaria se vuelve también representante', async () => {
      await servicio.registrar(alta({ persona: padre }));

      await servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      );

      expect(base.personas).toHaveLength(2);
      expect(base.representaciones).toEqual([
        { beneficiarioId: 'persona-3', representanteId: 'persona-1', parentesco: 'padre' },
      ]);
      // Ya había firmado el suyo: no firma otro.
      expect(base.consentimientos.filter((c) => c.personaId === 'persona-1')).toHaveLength(1);
    });
  });

  describe('menores (RF-M2-05)', () => {
    it('crea al menor con su representante; el representante otorga y firma el suyo', async () => {
      const resultado = await servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      );

      expect(resultado).toMatchObject({ resultado: 'creada', personaId: 'persona-1' });
      expect(base.representaciones).toEqual([
        { beneficiarioId: 'persona-1', representanteId: 'persona-2', parentesco: 'padre' },
      ]);
      expect(base.consentimientos).toEqual([
        { personaId: 'persona-2', otorganteId: null, version: 'sintetico-0' },
        { personaId: 'persona-1', otorganteId: 'persona-2', version: 'sintetico-0' },
      ]);
      // El representante no es beneficiario.
      expect(base.personas.find((p) => p.id === 'persona-2')?.tipoPoblacionId).toBeUndefined();
    });

    it('un menor sin representante se rechaza', async () => {
      await expect(servicio.registrar(alta({ persona: menor }))).rejects.toThrow(
        'necesita un representante',
      );
    });

    it('cumple 18 hoy: ya no es menor', async () => {
      const resultado = await servicio.registrar(
        alta({ persona: { ...menor, tipoDocumento: 'cc', fechaNacimiento: '2008-10-21' } }),
      );
      expect(resultado).toMatchObject({ resultado: 'creada' });
    });

    it('un representante menor de edad se rechaza', async () => {
      await expect(
        servicio.registrar(
          alta({
            persona: menor,
            representantes: [
              { persona: { ...padre, fechaNacimiento: '2010-01-01' }, parentesco: 'hermano_a' },
            ],
          }),
        ),
      ).rejects.toThrow('mayor de edad');
    });

    it('un representante que ya existe y es menor según lo guardado se rechaza', async () => {
      await servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      );
      base.membresias[0]!.finEn = new Date();

      await expect(
        servicio.registrar(
          alta({
            persona: { ...padre, numeroDocumento: '1088000099' },
            representantes: [
              { persona: { ...menor, fechaNacimiento: '1990-01-01' }, parentesco: 'otro' },
            ],
          }),
        ),
      ).rejects.toThrow('mayor de edad');
    });

    it('de un representante que ya existe manda la fecha guardada, no la recibida', async () => {
      await servicio.registrar(alta({ persona: padre }));

      const resultado = await servicio.registrar(
        alta({
          persona: menor,
          representantes: [
            { persona: { ...padre, fechaNacimiento: '2015-01-01' }, parentesco: 'padre' },
          ],
        }),
      );

      expect(resultado).toMatchObject({ resultado: 'creada' });
    });

    it('el mismo documento como persona y representante se rechaza', async () => {
      await expect(
        servicio.registrar(
          alta({
            persona: menor,
            representantes: [
              {
                persona: { ...padre, numeroDocumento: menor.numeroDocumento },
                parentesco: 'padre',
              },
            ],
          }),
        ),
      ).rejects.toThrow('repetido');
    });

    it('un menor que vuelve usa su representante vigente y no duplica el vínculo', async () => {
      await servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      );
      base.membresias[0]!.finEn = new Date();

      const resultado = await servicio.registrar(
        alta({ persona: menor, institucionId: institucionY }),
      );

      expect(resultado).toMatchObject({ resultado: 'creada' });
      expect(base.representaciones).toHaveLength(1);
      expect(base.consentimientos.at(-1)).toEqual({
        personaId: 'persona-1',
        otorganteId: 'persona-2',
        version: 'sintetico-0',
      });
    });

    it('un representante con otro tipo de documento devuelve tipo_distinto', async () => {
      await servicio.registrar(alta({ persona: padre }));
      const resultado = await servicio.registrar(
        alta({
          persona: menor,
          representantes: [{ persona: { ...padre, tipoDocumento: 'ce' }, parentesco: 'padre' }],
        }),
      );
      expect(resultado).toEqual({ resultado: 'tipo_distinto' });
      expect(base.personas).toHaveLength(1);
    });
  });

  describe('una sola membresía activa (SBA-28, RF-M2-07)', () => {
    it('en la misma institución devuelve ya_activa sin escribir', async () => {
      const primera = await servicio.registrar(alta());
      const consentimientos = base.consentimientos.length;

      const segunda = await servicio.registrar(alta());

      expect(segunda).toEqual({
        resultado: 'ya_activa',
        personaId: 'persona-1',
        membresia: (primera as { membresia: Membresia }).membresia,
      });
      expect(base.membresias).toHaveLength(1);
      expect(base.consentimientos).toHaveLength(consentimientos);
    });

    it('en otra institución no crea la membresía y abre una alerta (criterio 1)', async () => {
      await servicio.registrar(alta());

      const resultado = await servicio.registrar(alta({ institucionId: institucionY }));

      expect(resultado).toEqual({ resultado: 'duplicidad' });
      expect(base.membresias).toHaveLength(1);
      expect(base.alertas).toEqual([
        {
          beneficiarioId: 'persona-1',
          institucionId: institucionY,
          membresiaVigenteId: base.membresias[0]?.id,
        },
      ]);
    });

    it('abre la alerta aunque los representantes recibidos no sirvan', async () => {
      await servicio.registrar(
        alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
      );

      const resultado = await servicio.registrar(
        alta({
          persona: menor,
          institucionId: institucionY,
          representantes: [{ persona: { ...padre, tipoDocumento: 'ce' }, parentesco: 'padre' }],
        }),
      );

      expect(resultado).toEqual({ resultado: 'duplicidad' });
      expect(base.alertas).toHaveLength(1);
    });

    it('un segundo intento desde la misma institución no abre otra alerta', async () => {
      await servicio.registrar(alta());
      await servicio.registrar(alta({ institucionId: institucionY }));

      expect(await servicio.registrar(alta({ institucionId: institucionY }))).toEqual({
        resultado: 'duplicidad',
      });
      expect(base.alertas).toHaveLength(1);
    });

    it('quien vuelve después de cerrar recibe una membresía nueva (criterio 3)', async () => {
      await servicio.registrar(alta());
      base.membresias[0]!.finEn = new Date();

      await servicio.registrar(alta());

      expect(base.membresias).toHaveLength(2);
    });
  });
});
