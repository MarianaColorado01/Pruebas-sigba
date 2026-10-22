import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AVISO_DE_PRIVACIDAD, CABECERAS, type Rol } from '@sigba/shared-types';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsuarioConAsignaciones } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import { AsignacionesDeUsuario } from '../src/core/autorizacion/asignaciones-de-usuario.js';
import {
  CoreModule,
  GUARDS_GLOBALES,
  PrismaService,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../src/core/index.js';
import { configurarApp } from '../src/configurar-app.js';
import {
  BeneficiariosController,
  MembresiasController,
} from '../src/modules/beneficiarios/controllers/beneficiarios.controller.js';
import { MembresiasService } from '../src/modules/beneficiarios/services/membresias.service.js';
import { RegistroDeBeneficiariosService } from '../src/modules/beneficiarios/services/registro-de-beneficiarios.service.js';
import { RegistroSimultaneo } from '../src/modules/beneficiarios/services/registro.js';

/**
 * `POST /api/v1/beneficiarios` y `POST /api/v1/beneficiarios/busqueda`
 * (SBA-27), sin base de datos: el servicio es un doble. Prueba lo que pone el
 * controlador: códigos HTTP por resultado, el 409 con `codigo` y sin nombrar
 * otra institución, la forma del cuerpo y los roles. Datos sintéticos.
 */

const BANCO = '55555555-5555-4555-8555-555555555555';
const INSTITUCION = '01920000-0000-7000-8000-000000000001';

function conRol(rol: Rol, institucionId: string | null = null): UsuarioConAsignaciones {
  return {
    usuarioId: '88888888-0000-4000-8000-000000000001',
    asignaciones: [{ rol, bancoId: BANCO, institucionId }],
  };
}

const USUARIOS: Record<string, UsuarioConAsignaciones> = {
  coordinacion: conRol('coordinacion'),
  admin: conRol('admin_banco'),
  voluntario: conRol('voluntario'),
  institucion: conRol('institucion', INSTITUCION),
};

const verificador: TokenVerifier = {
  async verify(token) {
    return { auth0Sub: token, emisor: 'https://prueba.invalid/' };
  },
};

const ALTA = {
  institucionId: INSTITUCION,
  tipoPoblacionId: '01920000-0000-7000-8000-000000000002',
  persona: {
    tipoDocumento: 'cc',
    numeroDocumento: '1.077.000.001',
    nombres: 'Ana',
    apellidos: 'Sintética',
    sexo: 'femenino',
    fechaNacimiento: '1980-01-01',
  },
  consentimiento: { otorgado: true, versionAviso: AVISO_DE_PRIVACIDAD.version },
};

const MEMBRESIA = {
  id: '01920000-0000-7000-8000-000000000003',
  beneficiarioId: '01920000-0000-7000-8000-000000000004',
  institucionId: INSTITUCION,
  inicioEn: new Date('2026-10-21T15:00:00Z'),
  finEn: null,
  motivoFin: null,
};

describe('HTTP del registro nominal (SBA-27)', () => {
  let app: INestApplication<Server>;
  const registro = { registrar: vi.fn(), buscarPorDocumento: vi.fn() };
  const membresias = { cerrar: vi.fn(), trasladar: vi.fn(), historial: vi.fn() };

  function como(sub: string, ruta = '/api/v1/beneficiarios') {
    return request(app.getHttpServer())
      .post(ruta)
      .set('Authorization', `Bearer ${sub}`)
      .set(CABECERAS.banco, BANCO);
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [CoreModule],
      controllers: [BeneficiariosController, MembresiasController],
      providers: [
        ...GUARDS_GLOBALES,
        { provide: RegistroDeBeneficiariosService, useValue: registro },
        { provide: MembresiasService, useValue: membresias },
      ],
    })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verificador)
      .overrideProvider(AsignacionesDeUsuario)
      .useValue({ deIdentidad: async (sub: string) => USUARIOS[sub] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    app = modulo.createNestApplication();
    configurarApp(app, ['http://localhost:5173']);
    await app.init();
  });

  beforeEach(() => {
    registro.registrar.mockReset();
    registro.buscarPorDocumento.mockReset();
    for (const metodo of Object.values(membresias)) metodo.mockReset();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('201 con creada y 200 con ya_activa, con fechas ISO', async () => {
    registro.registrar
      .mockResolvedValueOnce({ resultado: 'creada', personaId: 'p-1', membresia: MEMBRESIA })
      .mockResolvedValueOnce({ resultado: 'ya_activa', personaId: 'p-1', membresia: MEMBRESIA });

    const primera = await como('coordinacion').send(ALTA).expect(201);
    await como('coordinacion').send(ALTA).expect(200);

    expect(primera.body).toEqual({
      resultado: 'creada',
      personaId: 'p-1',
      membresia: { ...MEMBRESIA, inicioEn: '2026-10-21T15:00:00.000Z' },
    });
    expect(registro.registrar).toHaveBeenCalledWith(ALTA);
  });

  it.each([
    [{ resultado: 'duplicidad' }, 'duplicidad'],
    [{ resultado: 'tipo_distinto' }, 'tipo_distinto'],
  ])('409 con el código de %j y sin datos de la persona', async (resultado, codigo) => {
    registro.registrar.mockResolvedValueOnce(resultado);

    const respuesta = await como('coordinacion').send(ALTA).expect(409);

    expect(respuesta.body).toMatchObject({ codigo });
    expect(JSON.stringify(respuesta.body)).not.toMatch(/1077000001|Ana|Sintética/);
  });

  it('409 registro_simultaneo cuando otra alta confirmó primero', async () => {
    registro.registrar.mockRejectedValueOnce(new RegistroSimultaneo());
    const respuesta = await como('coordinacion').send(ALTA).expect(409);
    expect(respuesta.body).toMatchObject({ codigo: 'registro_simultaneo' });
  });

  it('400 sin consentimiento marcado, con un campo de más o un enum desconocido', async () => {
    await como('coordinacion')
      .send({ ...ALTA, consentimiento: { otorgado: false, versionAviso: 'sintetico-0' } })
      .expect(400);
    await como('coordinacion')
      .send({ ...ALTA, salud: 'x' })
      .expect(400);
    await como('coordinacion')
      .send({ ...ALTA, persona: { ...ALTA.persona, tipoDocumento: 'otro' } })
      .expect(400);
    expect(registro.registrar).not.toHaveBeenCalled();
  });

  it('401 sin token y 403 a voluntario y a institución', async () => {
    await request(app.getHttpServer()).post('/api/v1/beneficiarios').send(ALTA).expect(401);
    await como('voluntario').send(ALTA).expect(403);
    await como('institucion').set(CABECERAS.institucion, INSTITUCION).send(ALTA).expect(403);
    expect(registro.registrar).not.toHaveBeenCalled();
  });

  it('la búsqueda va por cuerpo, responde 200 y fechas ISO', async () => {
    registro.buscarPorDocumento.mockResolvedValueOnce({
      persona: { id: 'p-1', nombres: 'Ana' },
      beneficiario: { tipoPoblacionId: 't', membresiaActiva: MEMBRESIA, representantes: [] },
    });

    const respuesta = await como('coordinacion', '/api/v1/beneficiarios/busqueda')
      .send({ numeroDocumento: '1.077.000.001' })
      .expect(200);

    expect(registro.buscarPorDocumento).toHaveBeenCalledWith('1.077.000.001');
    expect(respuesta.body.beneficiario.membresiaActiva.inicioEn).toBe('2026-10-21T15:00:00.000Z');
  });

  describe('membresías (SBA-28)', () => {
    const PERSONA = '01920000-0000-7000-8000-000000000004';

    it('cerrar responde 200 con la membresía; rechaza traslado y texto libre como motivo', async () => {
      membresias.cerrar.mockResolvedValueOnce({
        ...MEMBRESIA,
        finEn: new Date('2026-10-22T10:00:00Z'),
        motivoFin: 'se_mudo',
      });

      const respuesta = await como('admin', `/api/v1/membresias/${MEMBRESIA.id}/cerrar`)
        .send({ motivo: 'se_mudo' })
        .expect(200);

      expect(respuesta.body).toMatchObject({
        finEn: '2026-10-22T10:00:00.000Z',
        motivoFin: 'se_mudo',
      });
      await como('admin', `/api/v1/membresias/${MEMBRESIA.id}/cerrar`)
        .send({ motivo: 'traslado' })
        .expect(400);
      await como('admin', `/api/v1/membresias/${MEMBRESIA.id}/cerrar`)
        .send({ motivo: 'se fue porque estaba enfermo' })
        .expect(400);
      await como('admin', '/api/v1/membresias/no-es-uuid/cerrar')
        .send({ motivo: 'otro' })
        .expect(400);
      expect(membresias.cerrar).toHaveBeenCalledTimes(1);
    });

    it('el traslado es solo de coordinación y responde 201 con la membresía nueva', async () => {
      membresias.trasladar.mockResolvedValueOnce(MEMBRESIA);

      await como('admin', `/api/v1/beneficiarios/${PERSONA}/traslado`)
        .send({ institucionId: INSTITUCION })
        .expect(403);
      const respuesta = await como('coordinacion', `/api/v1/beneficiarios/${PERSONA}/traslado`)
        .send({ institucionId: INSTITUCION })
        .expect(201);

      expect(respuesta.body).toMatchObject({
        id: MEMBRESIA.id,
        inicioEn: '2026-10-21T15:00:00.000Z',
      });
      expect(membresias.trasladar).toHaveBeenCalledWith(PERSONA, INSTITUCION);
    });

    it('el historial responde la lista con fechas ISO; voluntario no lo ve', async () => {
      membresias.historial.mockResolvedValueOnce([MEMBRESIA]);

      const respuesta = await request(app.getHttpServer())
        .get(`/api/v1/beneficiarios/${PERSONA}/membresias`)
        .set('Authorization', 'Bearer coordinacion')
        .set(CABECERAS.banco, BANCO)
        .expect(200);

      expect(respuesta.body).toEqual([{ ...MEMBRESIA, inicioEn: '2026-10-21T15:00:00.000Z' }]);
      await request(app.getHttpServer())
        .get(`/api/v1/beneficiarios/${PERSONA}/membresias`)
        .set('Authorization', 'Bearer voluntario')
        .set(CABECERAS.banco, BANCO)
        .expect(403);
    });
  });
});
