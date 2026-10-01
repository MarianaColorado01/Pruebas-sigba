import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext, usePedir } from './sesion.ts';
import { SoloPara } from './SoloPara.tsx';

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bancoB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const instX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const instY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const operario: AsignacionActiva = { rol: 'operario_bodega', bancoId: bancoA, institucionId: null };
const institucion: AsignacionActiva = { rol: 'institucion', bancoId: bancoA, institucionId: instX };

function conSesion(asignacion: AsignacionActiva | null) {
  return ({ children }: { children: ReactNode }) => (
    <SesionContext value={asignacion}>{children}</SesionContext>
  );
}

describe('SoloPara', () => {
  const aprobar = (
    <SoloPara roles={['admin_banco', 'coordinacion']}>
      <button type="button">Aprobar precio</button>
    </SoloPara>
  );

  it('oculta a un operario_bodega lo que solo puede hacer coordinación', () => {
    render(aprobar, { wrapper: conSesion(operario) });

    expect(screen.queryByRole('button', { name: 'Aprobar precio' })).toBeNull();
  });

  it('lo muestra a coordinación', () => {
    render(aprobar, { wrapper: conSesion({ ...operario, rol: 'coordinacion' }) });

    expect(screen.getByRole('button', { name: 'Aprobar precio' })).toBeInTheDocument();
  });

  it('sin sesión no muestra nada', () => {
    render(aprobar, { wrapper: conSesion(null) });

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('usePedir', () => {
  afterEach(() => vi.restoreAllMocks());

  function cabecerasEnviadas(asignacion: AsignacionActiva | null, headers: HeadersInit = {}) {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const { result } = renderHook(() => usePedir(), { wrapper: conSesion(asignacion) });

    return result
      .current('/bodegas', { headers })
      .then(() => new Headers(fetch.mock.calls[0]?.[1]?.headers));
  }

  it('manda el banco y la institución de la sesión', async () => {
    const cabeceras = await cabecerasEnviadas(institucion);

    expect(cabeceras.get('x-banco-id')).toBe(bancoA);
    expect(cabeceras.get('x-institucion-id')).toBe(instX);
  });

  it('un rol de banco no manda institución', async () => {
    const cabeceras = await cabecerasEnviadas(operario);

    expect(cabeceras.get('x-banco-id')).toBe(bancoA);
    expect(cabeceras.has('x-institucion-id')).toBe(false);
  });

  it('sin sesión no inventa cabeceras', async () => {
    const cabeceras = await cabecerasEnviadas(null);

    expect(cabeceras.has('x-banco-id')).toBe(false);
  });

  it('conserva las cabeceras que llegan en un Headers', async () => {
    const cabeceras = await cabecerasEnviadas(operario, new Headers({ 'if-none-match': '"v1"' }));

    expect(cabeceras.get('if-none-match')).toBe('"v1"');
    expect(cabeceras.get('x-banco-id')).toBe(bancoA);
    expect(cabeceras.get('content-type')).toBe('application/json');
  });

  it('lee un arreglo de pares sin mandar una cabecera «0»', async () => {
    const cabeceras = await cabecerasEnviadas(operario, [['if-none-match', '"v1"']]);

    expect([...cabeceras.keys()]).toEqual(['content-type', 'if-none-match', 'x-banco-id']);
    expect(cabeceras.get('if-none-match')).toBe('"v1"');
  });

  it('gana lo que manda quien llama, aunque venga en mayúsculas', async () => {
    const cabeceras = await cabecerasEnviadas(institucion, {
      'Content-Type': 'text/plain',
      'X-Banco-Id': bancoB,
      'X-Institucion-Id': instY,
    });

    expect(cabeceras.get('content-type')).toBe('text/plain');
    expect(cabeceras.get('x-banco-id')).toBe(bancoB);
    expect(cabeceras.get('x-institucion-id')).toBe(instY);
  });
});
