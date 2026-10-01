import { describe, expect, it } from 'vitest';
import { type Asignacion, elegirAsignacion } from './elegir-asignacion.js';

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bancoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const instY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const deBanco = (rol: Asignacion['rol'], bancoId: string): Asignacion => ({
  rol,
  bancoId,
  institucionId: null,
});
const deInstitucion = (institucionId: string): Asignacion => ({
  rol: 'institucion',
  bancoId: bancoA,
  institucionId,
});
const superAdmin: Asignacion = { rol: 'super_admin', bancoId: null, institucionId: null };

describe('elegirAsignacion (Arquitectura 8.2)', () => {
  it('un operario_bodega no pasa por una ruta de aprobar precios', () => {
    const elegida = elegirAsignacion(
      [deBanco('operario_bodega', bancoA)],
      ['admin_banco', 'coordinacion'],
      bancoA,
    );

    expect(elegida).toBeUndefined();
  });

  it('el rol sirve solo en su banco', () => {
    const asignaciones = [deBanco('coordinacion', bancoA)];

    expect(elegirAsignacion(asignaciones, ['coordinacion'], bancoA)?.bancoId).toBe(bancoA);
    expect(elegirAsignacion(asignaciones, ['coordinacion'], bancoB)).toBeUndefined();
    expect(elegirAsignacion(asignaciones, ['coordinacion'])).toBeUndefined();
  });

  it('con roles en dos bancos elige el del banco pedido', () => {
    const asignaciones = [deBanco('consulta', bancoA), deBanco('admin_banco', bancoB)];

    expect(elegirAsignacion(asignaciones, ['consulta', 'admin_banco'], bancoB)?.rol).toBe(
      'admin_banco',
    );
  });

  it('super_admin pasa sin banco y queda sin banco', () => {
    const elegida = elegirAsignacion([superAdmin], ['super_admin'], bancoA);

    expect(elegida).toEqual(superAdmin);
  });

  it('una fila de super_admin con banco no cuenta como rol de banco', () => {
    const elegida = elegirAsignacion(
      [{ ...superAdmin, bancoId: bancoA }, deBanco('consulta', bancoA)],
      ['super_admin', 'consulta'],
      bancoA,
    );

    expect(elegida?.rol).toBe('consulta');
  });

  it('super_admin queda sin banco ni institución aunque su fila los traiga', () => {
    const conBanco: Asignacion = { ...superAdmin, bancoId: bancoA, institucionId: instX };
    const deOtroBanco: Asignacion = { ...superAdmin, bancoId: bancoB };

    expect(elegirAsignacion([conBanco], ['super_admin'], bancoA, instX)).toEqual(superAdmin);
    expect(elegirAsignacion([deOtroBanco], ['super_admin'], bancoA)).toEqual(superAdmin);
  });

  it('entre super_admin y un rol del banco pedido gana el del banco', () => {
    const elegida = elegirAsignacion(
      [superAdmin, deBanco('admin_banco', bancoA)],
      ['super_admin', 'admin_banco'],
      bancoA,
    );

    expect(elegida?.rol).toBe('admin_banco');
  });

  it('con dos roles en el mismo banco elige el mismo, venga en el orden que venga', () => {
    const coordinacion = deBanco('coordinacion', bancoA);
    const consulta = deBanco('consulta', bancoA);
    const permitidos = ['consulta', 'coordinacion'] as const;

    expect(elegirAsignacion([coordinacion, consulta], permitidos, bancoA)).toEqual(coordinacion);
    expect(elegirAsignacion([consulta, coordinacion], permitidos, bancoA)).toEqual(coordinacion);
  });

  it('entre super_admin y una institución, la cabecera de institución manda', () => {
    const asignaciones = [superAdmin, deInstitucion(instX)];
    const permitidos = ['super_admin', 'institucion'] as const;

    expect(elegirAsignacion(asignaciones, permitidos, bancoA, instX)).toEqual(deInstitucion(instX));
    expect(elegirAsignacion(asignaciones, permitidos, bancoA)).toEqual(superAdmin);
  });

  it('con una institución ajena en la cabecera, super_admin sigue como super_admin', () => {
    const elegida = elegirAsignacion(
      [superAdmin, deInstitucion(instX)],
      ['super_admin', 'institucion'],
      bancoA,
      instY,
    );

    expect(elegida).toEqual(superAdmin);
  });

  it('entre un rol de banco y uno de institución gana el de banco', () => {
    const elegida = elegirAsignacion(
      [deInstitucion(instX), deBanco('coordinacion', bancoA)],
      ['institucion', 'coordinacion'],
      bancoA,
    );

    expect(elegida?.rol).toBe('coordinacion');
  });

  it('una sola institución no necesita cabecera', () => {
    const elegida = elegirAsignacion([deInstitucion(instX)], ['institucion'], bancoA);

    expect(elegida?.institucionId).toBe(instX);
  });

  it('con dos instituciones decide la cabecera y sin ella no pasa', () => {
    const asignaciones = [deInstitucion(instX), deInstitucion(instY)];

    expect(elegirAsignacion(asignaciones, ['institucion'], bancoA, instY)?.institucionId).toBe(
      instY,
    );
    expect(elegirAsignacion(asignaciones, ['institucion'], bancoA)).toBeUndefined();
  });

  it('una institución que no es del usuario no pasa aunque venga en la cabecera', () => {
    const elegida = elegirAsignacion([deInstitucion(instX)], ['institucion'], bancoA, instY);

    expect(elegida).toBeUndefined();
  });
});
