import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import {
  CrearInstitucionDto,
  EditarInstitucionDto,
  FiltroDeInstitucionesDto,
} from './institucion.dto.js';

async function errores<T extends object>(clase: new () => T, cuerpo: object): Promise<string[]> {
  const fallos = await validate(plainToInstance(clase, cuerpo));
  return fallos.map((f) => f.property);
}

const valida = {
  nombre: 'Parroquia San José',
  tipo: 'parroquia',
  contactoNombre: 'María Gómez',
  tipoPoblacionId: '11111111-1111-4111-8111-111111111111',
};

describe('DTO de instituciones', () => {
  it('acepta un alta con lo mínimo y con opcionales nulos', async () => {
    expect(await errores(CrearInstitucionDto, valida)).toEqual([]);
    expect(
      await errores(CrearInstitucionDto, { ...valida, contactoCorreo: null, diaRecogida: null }),
    ).toEqual([]);
  });

  it('rechaza en el alta un tipo, un día o un tipo de población que no son válidos', async () => {
    const fallos = await errores(CrearInstitucionDto, {
      ...valida,
      tipo: 'club',
      diaRecogida: 'feriado',
      tipoPoblacionId: 'x',
    });

    expect(fallos.sort()).toEqual(['diaRecogida', 'tipo', 'tipoPoblacionId']);
  });

  it('en la edición deja faltar el nombre pero no mandarlo nulo', async () => {
    expect(await errores(EditarInstitucionDto, {})).toEqual([]);
    expect(await errores(EditarInstitucionDto, { nombre: null })).toEqual(['nombre']);
    expect(await errores(EditarInstitucionDto, { direccion: null })).toEqual([]);
  });

  it('el filtro solo incluye inactivas con el texto true', () => {
    expect(plainToInstance(FiltroDeInstitucionesDto, { incluirInactivas: 'true' })).toMatchObject({
      incluirInactivas: true,
    });
    expect(plainToInstance(FiltroDeInstitucionesDto, { incluirInactivas: '1' })).toMatchObject({
      incluirInactivas: false,
    });
  });
});
