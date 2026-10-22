import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ParametroListado } from '@sigba/shared-types';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext } from '@/shared/sesion';
import { PantallaParametros } from './PantallaParametros.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-token') }),
}));

const bancoA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const admin: AsignacionActiva = { rol: 'admin_banco', bancoId: bancoA, institucionId: null };
const coordinacion: AsignacionActiva = { ...admin, rol: 'coordinacion' };

const aporteViejo: ParametroListado = {
  clave: 'aporte_solidario_pct',
  valor: 6,
  version: 1,
  fecha_inicio: '2026-09-01',
  fecha_fin: '2026-09-30',
};
const aporte: ParametroListado = {
  clave: 'aporte_solidario_pct',
  valor: 8,
  version: 2,
  fecha_inicio: '2026-10-01',
  fecha_fin: null,
};
const rangos: ParametroListado = {
  clave: 'rangos_etarios',
  valor: [
    { desde: 0, hasta: 17 },
    { desde: 18, hasta: null },
  ],
  version: 1,
  fecha_inicio: '2026-10-01',
  fecha_fin: null,
};

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

function montar(asignacion: AsignacionActiva) {
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltura = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={consultas}>
      <SesionContext value={asignacion}>{children}</SesionContext>
    </QueryClientProvider>
  );
  return render(<PantallaParametros />, { wrapper: envoltura });
}

const cuerpoDelPut = (fetch: ReturnType<typeof api>) =>
  fetch.mock.calls.find(([, opciones]) => opciones?.method === 'PUT');

describe('PantallaParametros', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T15:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('muestra el valor vigente de cada parámetro y cuáles no tienen', async () => {
    api({ 'GET /parametros': json([aporte, rangos]) });
    montar(admin);

    expect(await screen.findByText('8 %')).toBeInTheDocument();
    expect(screen.getByText('0 a 17, 18 o más años')).toBeInTheDocument();
    expect(screen.getAllByText('Sin valor vigente')).toHaveLength(5);
  });

  it('abre el historial, de la versión más nueva a la más vieja', async () => {
    api({
      'GET /parametros': json([aporte]),
      'GET /parametros/aporte_solidario_pct/historial': json([aporteViejo, aporte]),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Aporte solidario/ }));

    const versiones = await screen.findAllByText(/^Versión \d/);
    expect(versiones.map((v) => v.textContent)).toEqual([
      'Versión 2 · Vigente desde el 1 oct 2026',
      'Versión 1 · Del 1 sept 2026 al 30 sept 2026',
    ]);
  });

  it('programa una versión nueva con valor y fecha de inicio', async () => {
    const fetch = api({
      'GET /parametros': json([aporte]),
      'GET /parametros/aporte_solidario_pct/historial': json([aporte]),
      'PUT /parametros/aporte_solidario_pct': json({ ...aporte, valor: 9.5, version: 3 }),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Aporte solidario/ }));
    fireEvent.change(screen.getByLabelText('Valor nuevo (%)'), { target: { value: '9,5' } });
    fireEvent.change(screen.getByLabelText('Rige desde'), { target: { value: '2026-11-01' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva versión' }));

    await waitFor(() =>
      expect(cuerpoDelPut(fetch)?.[1]?.body).toBe(
        JSON.stringify({ valor: 9.5, fechaInicio: '2026-11-01' }),
      ),
    );
  });

  it('no deja programar una fecha pasada', async () => {
    const fetch = api({
      'GET /parametros': json([aporte]),
      'GET /parametros/aporte_solidario_pct/historial': json([aporte]),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Aporte solidario/ }));
    fireEvent.change(screen.getByLabelText('Rige desde'), { target: { value: '2026-10-20' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva versión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Lo que ya rigió no se edita.');
    expect(cuerpoDelPut(fetch)).toBeUndefined();
  });

  it('explica el rechazo de un valor fuera de rango', async () => {
    api({
      'GET /parametros': json([aporte]),
      'GET /parametros/aporte_solidario_pct/historial': json([aporte]),
      'PUT /parametros/aporte_solidario_pct': json({ message: 'inválido' }, 400),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Aporte solidario/ }));
    fireEvent.change(screen.getByLabelText('Valor nuevo (%)'), { target: { value: '15' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva versión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no cumple la regla');
  });

  it('muestra el motivo del 409 que manda la API', async () => {
    const motivo = 'La fecha de inicio no puede ser anterior a hoy ni a la última versión.';
    api({
      'GET /parametros': json([aporte]),
      'GET /parametros/aporte_solidario_pct/historial': json([aporte]),
      'PUT /parametros/aporte_solidario_pct': json({ message: motivo }, 409),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Aporte solidario/ }));
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva versión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(motivo);
  });

  it('edita los rangos etarios y deja el último sin tope', async () => {
    const fetch = api({
      'GET /parametros': json([rangos]),
      'GET /parametros/rangos_etarios/historial': json([rangos]),
      'PUT /parametros/rangos_etarios': json(rangos),
    });
    montar(admin);

    fireEvent.click(await screen.findByRole('button', { name: /Rangos etarios/ }));
    fireEvent.change(screen.getByLabelText('Hasta, rango 2'), { target: { value: '59' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar rango' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Nueva versión' }));

    await waitFor(() =>
      expect(JSON.parse(String(cuerpoDelPut(fetch)?.[1]?.body))).toEqual({
        valor: [
          { desde: 0, hasta: 17 },
          { desde: 18, hasta: 59 },
          { desde: 60, hasta: null },
        ],
        fechaInicio: '2026-10-21',
      }),
    );
  });

  it('a un rol que no es admin_banco no le pide nada a la API', () => {
    const fetch = api({});
    montar(coordinacion);

    expect(screen.getByText(/Tu rol no tiene acceso/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
