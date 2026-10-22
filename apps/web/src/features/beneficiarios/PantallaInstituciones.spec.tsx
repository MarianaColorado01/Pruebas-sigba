import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { InstitucionDto, TipoDePoblacionDto } from '@sigba/shared-types';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext } from '@/shared/sesion';
import { PantallaInstituciones } from './PantallaInstituciones.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-token') }),
}));

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const coordinacion: AsignacionActiva = {
  rol: 'coordinacion',
  bancoId: bancoA,
  institucionId: null,
};

const familias: TipoDePoblacionDto = { id: 'p-1', nombre: 'Familias', activo: true };
const viejo: TipoDePoblacionDto = { id: 'p-2', nombre: 'Adultos mayores', activo: false };

const sanJose: InstitucionDto = {
  id: 'i-1',
  nombre: 'Parroquia San José',
  tipo: 'parroquia',
  contactoNombre: 'María Gómez',
  contactoTelefono: '310 000 0000',
  contactoCorreo: null,
  direccion: null,
  diaRecogida: 'martes',
  tipoPoblacionId: 'p-2',
  activa: true,
  actualizadoPor: null,
  actualizadoEn: null,
};
const cerrada: InstitucionDto = {
  ...sanJose,
  id: 'i-2',
  nombre: 'Fundación Cerrada',
  tipo: 'fundacion',
  contactoNombre: 'Luis Pérez',
  diaRecogida: null,
  activa: false,
};

const LISTA = 'GET /instituciones?incluirInactivas=true';

/** Responde a la API según método y ruta; lo que no conoce es 404. */
function api(respuestas: Record<string, () => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opciones) => {
    const ruta = String(url).replace(/^.*\/api\/v1/, '');
    const responder = respuestas[`${opciones?.method ?? 'GET'} ${ruta}`];
    return responder ? responder() : new Response('{}', { status: 404 });
  });
}
const json =
  (cuerpo: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(cuerpo), { status });

function montar() {
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltura = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={consultas}>
      <SesionContext value={coordinacion}>{children}</SesionContext>
    </QueryClientProvider>
  );
  return render(<PantallaInstituciones />, { wrapper: envoltura });
}

const cuerpoDe = (fetch: ReturnType<typeof api>, metodo: string) =>
  fetch.mock.calls.find(([, opciones]) => opciones?.method === metodo)?.[1]?.body;

describe('PantallaInstituciones', () => {
  afterEach(() => vi.restoreAllMocks());

  it('muestra las activas, cuenta las inactivas y busca sin importar tildes', async () => {
    api({ [LISTA]: json([sanJose, cerrada]), 'GET /tipos-de-poblacion': json([familias]) });
    montar();

    expect(await screen.findByText('Parroquia San José')).toBeInTheDocument();
    expect(screen.getByText('Parroquia · Recoge los martes')).toBeInTheDocument();
    expect(screen.getByText('1 activa · 1 inactiva')).toBeInTheDocument();
    expect(screen.queryByText('Fundación Cerrada')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Todas' }));
    expect(screen.getByText('Fundación Cerrada')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Buscar institución'), { target: { value: 'maria' } });
    expect(screen.getByText('Parroquia San José')).toBeInTheDocument();
    expect(screen.queryByText('Fundación Cerrada')).toBeNull();

    fireEvent.change(screen.getByLabelText('Buscar institución'), { target: { value: 'xyz' } });
    expect(screen.getByText('Ninguna institución coincide con la búsqueda.')).toBeInTheDocument();
  });

  it('crea una institución con los opcionales vacíos en null', async () => {
    const fetch = api({
      [LISTA]: json([]),
      'GET /tipos-de-poblacion': json([familias, viejo]),
      'POST /instituciones': json({ ...sanJose, id: 'i-3' }, 201),
    });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Nueva' }));
    const hoja = await screen.findByRole('dialog');
    // El tipo inactivo no se ofrece para una institución nueva.
    await within(hoja).findByRole('option', { name: 'Familias' });
    expect(within(hoja).queryByRole('option', { name: 'Adultos mayores' })).toBeNull();

    fireEvent.change(within(hoja).getByLabelText('Nombre'), {
      target: { value: ' Comedor La Paz ' },
    });
    fireEvent.change(within(hoja).getByLabelText('Tipo'), { target: { value: 'fundacion' } });
    fireEvent.change(within(hoja).getByLabelText('Población que atiende'), {
      target: { value: 'p-1' },
    });
    fireEvent.change(within(hoja).getByLabelText('Persona de contacto'), {
      target: { value: 'Ana Ríos' },
    });
    fireEvent.change(within(hoja).getByLabelText('Día de recogida'), {
      target: { value: 'jueves' },
    });
    fireEvent.click(within(hoja).getByRole('button', { name: 'Agregar institución' }));

    await waitFor(() =>
      expect(cuerpoDe(fetch, 'POST')).toBe(
        JSON.stringify({
          nombre: 'Comedor La Paz',
          tipo: 'fundacion',
          tipoPoblacionId: 'p-1',
          contactoNombre: 'Ana Ríos',
          contactoTelefono: null,
          contactoCorreo: null,
          direccion: null,
          diaRecogida: 'jueves',
        }),
      ),
    );
  });

  it('dice qué falta antes de llamar a la API', async () => {
    const fetch = api({ [LISTA]: json([]), 'GET /tipos-de-poblacion': json([familias]) });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Nueva' }));
    const hoja = await screen.findByRole('dialog');
    fireEvent.click(within(hoja).getByRole('button', { name: 'Agregar institución' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent(
      'Falta: nombre, tipo, población que atiende, persona de contacto.',
    );
    expect(cuerpoDe(fetch, 'POST')).toBeUndefined();
  });

  it('con nombre repetido avisa y conserva lo escrito', async () => {
    api({
      [LISTA]: json([sanJose]),
      'GET /tipos-de-poblacion': json([familias, viejo]),
      'PATCH /instituciones/i-1': json(
        { message: 'Ya existe una institución con ese nombre.' },
        409,
      ),
    });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: /Parroquia San José/ }));
    const hoja = await screen.findByRole('dialog');
    fireEvent.change(within(hoja).getByLabelText('Nombre'), {
      target: { value: 'Fundación Cerrada' },
    });
    fireEvent.click(within(hoja).getByRole('button', { name: 'Guardar cambios' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent(
      'Ya hay una institución con ese nombre en este banco.',
    );
    expect(within(hoja).getByLabelText('Nombre')).toHaveValue('Fundación Cerrada');
  });

  it('muestra el motivo que da la API cuando rechaza un dato', async () => {
    api({
      [LISTA]: json([sanJose]),
      'GET /tipos-de-poblacion': json([familias, viejo]),
      'PATCH /instituciones/i-1': json(
        { message: 'El correo de contacto no tiene una forma válida.' },
        400,
      ),
    });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: /Parroquia San José/ }));
    const hoja = await screen.findByRole('dialog');
    // Conserva el tipo de población inactivo que ya tenía.
    expect(within(hoja).getByLabelText('Población que atiende')).toHaveValue('p-2');
    fireEvent.change(within(hoja).getByLabelText('Correo (opcional)'), {
      target: { value: 'maria@' },
    });
    fireEvent.click(within(hoja).getByRole('button', { name: 'Guardar cambios' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent(
      'El correo de contacto no tiene una forma válida.',
    );
  });

  it('desactiva solo después de confirmar', async () => {
    const fetch = api({
      [LISTA]: json([sanJose]),
      'GET /tipos-de-poblacion': json([familias]),
      'POST /instituciones/i-1/desactivar': json({ ...sanJose, activa: false }),
    });
    montar();

    fireEvent.click(await screen.findByRole('button', { name: /Parroquia San José/ }));
    const hoja = await screen.findByRole('dialog');
    fireEvent.click(within(hoja).getByRole('button', { name: 'Desactivar institución' }));
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/desactivar'))).toBe(false);

    fireEvent.click(within(hoja).getByRole('button', { name: 'Sí, desactivar' }));

    await waitFor(() =>
      expect(fetch.mock.calls.map(([url]) => String(url))).toContainEqual(
        expect.stringMatching(/\/instituciones\/i-1\/desactivar$/),
      ),
    );
  });

  it('con 403 dice quién tiene acceso', async () => {
    api({ [LISTA]: json({}, 403), 'GET /tipos-de-poblacion': json({}, 403) });
    montar();

    expect(
      await screen.findByText(
        'Solo la administración del banco y coordinación ven el directorio de instituciones.',
      ),
    ).toBeInTheDocument();
  });
});
