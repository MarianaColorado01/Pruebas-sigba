import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AVISO_DE_PRIVACIDAD } from '@sigba/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MembresiasService } from './membresias.service.js';
import {
  type AltaDeBeneficiario,
  edad,
  normalizarDocumento,
  type PersonaRecibida,
  RegistroDeBeneficiariosService,
} from './registro-de-beneficiarios.service.js';
import type { EventoDeMembresia } from '../events/membresias.js';
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
  eventos: EventoDeMembresia[] = [];
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
      .map((r) => ({
        id: r.representanteId,
        numeroDocumento: this.personas.find((p) => p.id === r.representanteId)!.numeroDocumento,
      }));
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
  async cerrarMembresia(id: string, motivo: Membresia['motivoFin']) {
    const membresia = this.membresias.find((m) => m.id === id && !m.finEn);
    if (!membresia) return null;
    membresia.finEn = new Date();
    membresia.motivoFin = motivo;
    return { ...membresia };
  }
  async emitir(evento: EventoDeMembresia) {
    this.eventos.push(evento);
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
  async historial(beneficiarioId: string) {
    const propias = this.base.membresias.filter((m) => m.beneficiarioId === beneficiarioId);
    return propias.length ? propias.reverse() : null;
  }
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

    it('emite MembresiaActivada con solo identificadores (ADR-09, Arquitectura 8.6)', async () => {
      await servicio.registrar(alta());

      expect(base.eventos).toEqual([
        {
          tipo: 'MembresiaActivada',
          version: 1,
          payload: {
            membresiaId: base.membresias[0]?.id,
            beneficiarioId: 'persona-1',
            institucionId: institucionX,
          },
        },
      ]);
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

    describe('quién otorga el consentimiento (SBA-96)', () => {
      const madre: PersonaRecibida = {
        ...padre,
        numeroDocumento: '1088000004',
        nombres: 'Marta',
        sexo: 'femenino',
      };
      const dos = [
        { persona: padre, parentesco: 'padre' as const },
        { persona: madre, parentesco: 'madre' as const },
      ];
      const otorgado = (otorganteNumeroDocumento?: string) => ({
        otorgado: true,
        versionAviso: AVISO_DE_PRIVACIDAD.version,
        otorganteNumeroDocumento,
      });
      /** El cuerpo del 400, o `null` si el alta pasó. */
      const rechazo = async (envio: Promise<unknown>) =>
        (
          await envio.then(
            () => null,
            (e: BadRequestException) => e,
          )
        )?.getResponse();

      it('con dos representantes nuevos otorga el indicado y no el primero', async () => {
        await servicio.registrar(
          alta({ persona: menor, representantes: dos, consentimiento: otorgado('1.088.000.004') }),
        );

        expect(base.consentimientos.at(-1)).toMatchObject({
          personaId: 'persona-1',
          otorganteId: 'persona-3',
        });
      });

      it('con dos representantes y sin otorgante pide indicarlo y no escribe nada', async () => {
        const cuerpo = await rechazo(
          servicio.registrar(alta({ persona: menor, representantes: dos })),
        );

        expect(cuerpo).toMatchObject({ codigo: 'otorgante_requerido' });
        expect(base.personas).toEqual([]);
        expect(base.consentimientos).toEqual([]);
      });

      it('un documento ajeno a los representantes da otorgante_invalido sin repetirlo', async () => {
        const cuerpo = await rechazo(
          servicio.registrar(
            alta({ persona: menor, representantes: dos, consentimiento: otorgado('999888777') }),
          ),
        );

        expect(cuerpo).toMatchObject({ codigo: 'otorgante_invalido' });
        expect(JSON.stringify(cuerpo)).not.toMatch(/999888777|1088000/);
        expect(base.personas).toEqual([]);
      });

      it('un documento mal formado también da otorgante_invalido', async () => {
        const cuerpo = await rechazo(
          servicio.registrar(
            alta({ persona: menor, representantes: dos, consentimiento: otorgado('¿?') }),
          ),
        );
        expect(cuerpo).toMatchObject({ codigo: 'otorgante_invalido' });
      });

      it('el menor no se otorga a sí mismo el consentimiento', async () => {
        const cuerpo = await rechazo(
          servicio.registrar(
            alta({
              persona: menor,
              representantes: [{ persona: padre, parentesco: 'padre' }],
              consentimiento: otorgado(menor.numeroDocumento),
            }),
          ),
        );
        expect(cuerpo).toMatchObject({ codigo: 'otorgante_invalido' });
      });

      it('con un solo representante el campo se omite; si llega, es el suyo', async () => {
        await servicio.registrar(
          alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
        );
        expect(base.consentimientos.at(-1)?.otorganteId).toBe('persona-2');

        const cuerpo = await rechazo(
          servicio.registrar(
            alta({
              persona: { ...menor, numeroDocumento: '1088000010' },
              representantes: [{ persona: padre, parentesco: 'padre' }],
              consentimiento: otorgado(madre.numeroDocumento),
            }),
          ),
        );
        expect(cuerpo).toMatchObject({ codigo: 'otorgante_invalido' });
      });

      it('un vigente y uno nuevo cuentan juntos: sin otorgante se rechaza, con él se elige', async () => {
        await servicio.registrar(
          alta({ persona: menor, representantes: [{ persona: padre, parentesco: 'padre' }] }),
        );
        base.membresias[0]!.finEn = new Date();
        const vuelve = alta({
          persona: menor,
          institucionId: institucionY,
          representantes: [{ persona: madre, parentesco: 'madre' }],
        });

        const cuerpo = await rechazo(servicio.registrar(vuelve));
        expect(cuerpo).toMatchObject({ codigo: 'otorgante_requerido' });
        expect(base.representaciones).toHaveLength(1);
        expect(base.consentimientos).toHaveLength(2);

        await servicio.registrar({ ...vuelve, consentimiento: otorgado(padre.numeroDocumento) });
        expect(base.consentimientos.at(-1)).toMatchObject({
          personaId: 'persona-1',
          otorganteId: 'persona-2',
        });
        expect(base.representaciones).toHaveLength(2);
      });

      it('un menor que vuelve con dos vigentes elige cuál otorga', async () => {
        await servicio.registrar(
          alta({ persona: menor, representantes: dos, consentimiento: otorgado('1088000003') }),
        );
        base.membresias[0]!.finEn = new Date();
        const vuelve = alta({ persona: menor, institucionId: institucionY });

        const cuerpo = await rechazo(servicio.registrar(vuelve));
        expect(cuerpo).toMatchObject({ codigo: 'otorgante_requerido' });

        await servicio.registrar({ ...vuelve, consentimiento: otorgado('1088000004') });
        expect(base.consentimientos.at(-1)).toMatchObject({ otorganteId: 'persona-3' });
      });

      it('el documento se compara normalizado', async () => {
        await servicio.registrar(
          alta({
            persona: menor,
            representantes: dos,
            consentimiento: otorgado(' 1-088-000-003 '),
          }),
        );
        expect(base.consentimientos.at(-1)?.otorganteId).toBe('persona-2');
      });

      it('una adulta no lleva otorgante', async () => {
        const cuerpo = await rechazo(
          servicio.registrar(alta({ consentimiento: otorgado(adulta.numeroDocumento) })),
        );
        expect(cuerpo).toMatchObject({ codigo: 'otorgante_invalido' });
        expect(base.personas).toEqual([]);
      });

      it('un menor sin representante sigue sin codigo: no hay a quién elegir', async () => {
        const cuerpo = await rechazo(
          servicio.registrar(alta({ persona: menor, consentimiento: otorgado('1088000003') })),
        );
        expect(cuerpo).not.toHaveProperty('codigo');
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
      expect(base.eventos).toHaveLength(1);
    });

    it('en otra institución no crea la membresía y abre una alerta (criterio 1)', async () => {
      await servicio.registrar(alta());

      const resultado = await servicio.registrar(alta({ institucionId: institucionY }));

      expect(resultado).toEqual({ resultado: 'duplicidad' });
      expect(base.membresias).toHaveLength(1);
      expect(base.eventos.map((e) => e.tipo)).toEqual(['MembresiaActivada']);
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

describe('MembresiasService (SBA-28)', () => {
  let base: BaseFalsa;
  let membresias: MembresiasService;
  let registro: RegistroDeBeneficiariosService;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
    base = new BaseFalsa();
    const repositorio = new RepositorioFalso(base);
    membresias = new MembresiasService(repositorio);
    registro = new RegistroDeBeneficiariosService(repositorio);
    await registro.registrar(alta());
    base.eventos = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const activa = () => base.membresias.find((m) => !m.finEn);

  it('cierra con motivo y fecha, y emite MembresiaCerrada', async () => {
    const id = activa()?.id as string;

    const cerrada = await membresias.cerrar(id, 'se_mudo');

    expect(cerrada).toMatchObject({ id, motivoFin: 'se_mudo', finEn: expect.any(Date) });
    expect(base.eventos).toEqual([
      {
        tipo: 'MembresiaCerrada',
        version: 1,
        payload: { membresiaId: id, beneficiarioId: 'persona-1', institucionId: institucionX },
      },
    ]);
  });

  it('no cierra con motivo traslado ni con uno desconocido', async () => {
    const id = activa()?.id as string;
    await expect(membresias.cerrar(id, 'traslado' as 'otro')).rejects.toThrow(BadRequestException);
    await expect(membresias.cerrar(id, 'enfermo' as 'otro')).rejects.toThrow(BadRequestException);
    expect(activa()).toBeDefined();
  });

  it('una membresía cerrada no se cierra otra vez ni se reabre', async () => {
    const id = activa()?.id as string;
    await membresias.cerrar(id, 'otro');
    await expect(membresias.cerrar(id, 'otro')).rejects.toThrow(NotFoundException);
    expect(base.eventos).toHaveLength(1);
  });

  it('traslada: cierra A con motivo traslado y abre B, con los dos eventos (criterio 2)', async () => {
    const anterior = activa()?.id;

    const nueva = await membresias.trasladar('persona-1', institucionY);

    expect(nueva).toMatchObject({ institucionId: institucionY, finEn: null });
    expect(base.membresias.find((m) => m.id === anterior)).toMatchObject({
      motivoFin: 'traslado',
      finEn: expect.any(Date),
    });
    expect(base.eventos.map((e) => e.tipo)).toEqual(['MembresiaCerrada', 'MembresiaActivada']);
  });

  it('no traslada sin membresía activa, a la misma institución ni a una inactiva', async () => {
    await expect(membresias.trasladar('persona-1', institucionX)).rejects.toThrow(
      ConflictException,
    );
    base.institucionesActivas.delete(institucionY);
    await expect(membresias.trasladar('persona-1', institucionY)).rejects.toThrow(
      NotFoundException,
    );
    await expect(membresias.trasladar('persona-9', institucionY)).rejects.toThrow(
      NotFoundException,
    );
    expect(base.eventos).toHaveLength(0);
  });

  it('quien vuelve a A recibe otra membresía y el historial conserva las dos (criterio 3)', async () => {
    await membresias.cerrar(activa()?.id as string, 'dejo_de_asistir');
    await registro.registrar(alta());

    const historial = await membresias.historial('persona-1');

    expect(historial).toHaveLength(2);
    expect(historial[0]).toMatchObject({ finEn: null });
    expect(historial[1]).toMatchObject({ motivoFin: 'dejo_de_asistir' });
  });

  it('el historial de un beneficiario que no existe da 404', async () => {
    await expect(membresias.historial('persona-9')).rejects.toThrow(NotFoundException);
  });
});
