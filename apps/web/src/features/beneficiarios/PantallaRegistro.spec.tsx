import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AsignacionActiva, SesionContext } from '@/shared/sesion';
import type {
  BeneficiarioRegistrado,
  DatosDePersona,
  FichaDeBeneficiario,
  InstitucionDto,
  MembresiaDto,
  PersonaDto,
  RegistrarBeneficiario,
  TipoDePoblacionDto,
} from '@sigba/shared-types';
import { PantallaRegistro } from './PantallaRegistro.tsx';

vi.mock('@auth0/auth0-react', () => ({
  useAuth0: () => ({ getAccessTokenSilently: vi.fn().mockResolvedValue('synthetic-token') }),
}));

// Datos sintéticos: ninguna persona real.
const coordinacion: AsignacionActiva = {
  rol: 'coordinacion',
  bancoId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  institucionId: null,
};
const institucion = (id: string, nombre: string, tipoPoblacionId: string): InstitucionDto => ({
  id,
  nombre,
  tipo: 'parroquia',
  contactoNombre: 'Contacto Sintético',
  contactoTelefono: null,
  contactoCorreo: null,
  direccion: null,
  diaRecogida: null,
  tipoPoblacionId,
  activa: true,
  actualizadoPor: null,
  actualizadoEn: null,
});
const sanJose = institucion('i-1', 'Parroquia San José', 'tp-1');
const elRefugio = institucion('i-2', 'Fundación El Refugio', 'tp-2');
const tipos: TipoDePoblacionDto[] = [
  { id: 'tp-1', nombre: 'Adulto mayor', activo: true },
  { id: 'tp-2', nombre: 'Primera infancia', activo: true },
  { id: 'tp-3', nombre: 'Tipo retirado', activo: false },
];
const DOCUMENTO = '900111222';

const datosDeAdulta: DatosDePersona = {
  tipoDocumento: 'cc',
  numeroDocumento: DOCUMENTO,
  nombres: 'Ana Prueba',
  apellidos: 'Sintética',
  sexo: 'femenino',
  fechaNacimiento: '1985-03-14',
  telefono: null,
  direccion: null,
};
const adulta: PersonaDto = { id: 'p-1', ...datosDeAdulta, telefono: null, direccion: null };

const membresia = (institucionId: string): MembresiaDto => ({
  id: 'm-1',
  beneficiarioId: 'p-1',
  institucionId,
  inicioEn: '2026-10-21T15:00:00Z',
  finEn: null,
  motivoFin: null,
});
const creada: BeneficiarioRegistrado = {
  resultado: 'creada',
  personaId: 'p-1',
  membresia: membresia('i-1'),
};
const NADIE: FichaDeBeneficiario = { persona: null, beneficiario: null };

type Respuesta = () => Response | Promise<Response>;

/** Responde a la API según método y ruta; lo que no conoce es 404. */
function api(respuestas: Record<string, Respuesta>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, opciones) => {
    const ruta = String(url).replace(/^.*\/api\/v1/, '');
    const responder = respuestas[`${opciones?.method ?? 'GET'} ${ruta}`];
    return responder ? responder() : new Response('{}', { status: 404 });
  });
}
const json =
  (cuerpo: unknown, status = 200): Respuesta =>
  () =>
    new Response(JSON.stringify(cuerpo), { status });

/** Las listas de los selectores más lo que diga cada prueba. */
const conListas = (respuestas: Record<string, Respuesta>) =>
  api({
    'GET /instituciones': json([sanJose, elRefugio]),
    'GET /tipos-de-poblacion': json(tipos),
    ...respuestas,
  });

function montar() {
  const consultas = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const envoltura = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={consultas}>
      <SesionContext value={coordinacion}>{children}</SesionContext>
    </QueryClientProvider>
  );
  return render(<PantallaRegistro />, { wrapper: envoltura });
}

const escribir = (etiqueta: string | RegExp, valor: string, indice = 0) =>
  fireEvent.change(screen.getAllByLabelText(etiqueta)[indice]!, { target: { value: valor } });

function buscar(numero = DOCUMENTO) {
  escribir('Número de documento', numero);
  fireEvent.submit(screen.getByRole('form', { name: 'Buscar documento' }));
}

async function elegirSanJose() {
  await screen.findByRole('option', { name: 'Parroquia San José' });
  escribir('Institución', 'i-1');
}

async function llenarAdulta() {
  await screen.findByRole('form', { name: 'Registrar persona' });
  escribir('Nombres', 'Ana Prueba');
  escribir('Apellidos', 'Sintética');
  fireEvent.click(screen.getAllByLabelText('Femenino')[0]!);
  escribir('Fecha de nacimiento', '1985-03-14');
  await elegirSanJose();
}

const autorizar = () => fireEvent.click(screen.getByRole('checkbox'));
const registrar = () => fireEvent.submit(screen.getByRole('form', { name: 'Registrar persona' }));

function cuerpoDelAlta(fetch: ReturnType<typeof api>): RegistrarBeneficiario | undefined {
  const llamada = fetch.mock.calls.find(
    ([url, opciones]) => String(url).endsWith('/beneficiarios') && opciones?.method === 'POST',
  );
  return llamada ? (JSON.parse(String(llamada[1]?.body)) as RegistrarBeneficiario) : undefined;
}

describe('PantallaRegistro', () => {
  beforeEach(() => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true));
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registra a una persona nueva con la versión del aviso que mostró', async () => {
    const guardar = vi.spyOn(Storage.prototype, 'setItem');
    const fetch = conListas({
      'POST /beneficiarios/busqueda': json(NADIE),
      'POST /beneficiarios': json(creada, 201),
    });
    montar();

    buscar();
    await llenarAdulta();
    expect(screen.getByLabelText('Tipo de población')).toHaveValue('tp-1');
    expect(screen.queryByRole('option', { name: 'Tipo retirado' })).toBeNull();
    escribir('Tipo de población', 'tp-2');
    autorizar();
    registrar();

    expect(await screen.findByText('Registrada en Parroquia San José.')).toBeInTheDocument();
    const busqueda = fetch.mock.calls.find(([url]) => String(url).endsWith('/busqueda'));
    expect(String(busqueda?.[0])).not.toContain(DOCUMENTO);
    expect(busqueda?.[1]?.body).toBe(JSON.stringify({ numeroDocumento: DOCUMENTO }));
    expect(cuerpoDelAlta(fetch)).toEqual({
      institucionId: 'i-1',
      tipoPoblacionId: 'tp-2',
      persona: datosDeAdulta,
      consentimiento: { otorgado: true, versionAviso: 'sintetico-0' },
    });
    expect(guardar).not.toHaveBeenCalled();
  });

  it('no envía sin la autorización de tratamiento de datos', async () => {
    const fetch = conListas({ 'POST /beneficiarios/busqueda': json(NADIE) });
    montar();

    buscar();
    await llenarAdulta();
    registrar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sin la autorización de tratamiento de datos no se puede registrar.',
    );
    expect(cuerpoDelAlta(fetch)).toBeUndefined();
  });

  it('a un menor nuevo le pide un representante legal mayor de edad', async () => {
    const fetch = conListas({
      'POST /beneficiarios/busqueda': json(NADIE),
      'POST /beneficiarios': json(creada, 201),
    });
    montar();

    escribir('Tipo de documento', 'registro_civil');
    buscar('1101234567');
    await llenarAdulta();
    escribir('Fecha de nacimiento', '2019-06-01');
    autorizar();

    expect(screen.getByRole('group', { name: 'Representante legal' })).toBeInTheDocument();
    registrar();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Completa los datos del representante legal.',
    );

    escribir('Número de documento', '41222333', 1);
    escribir('Nombres', 'Marta Prueba', 1);
    escribir('Apellidos', 'Sintética', 1);
    fireEvent.click(screen.getAllByLabelText('Femenino')[1]!);
    escribir('Fecha de nacimiento', '2015-01-01', 1);
    registrar();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El representante legal debe ser mayor de edad.',
    );

    escribir('Fecha de nacimiento', '1990-01-01', 1);
    escribir('Parentesco', 'madre');
    registrar();

    await screen.findByText('Registrada en Parroquia San José.');
    expect(cuerpoDelAlta(fetch)?.representantes).toEqual([
      {
        parentesco: 'madre',
        persona: {
          tipoDocumento: 'cc',
          numeroDocumento: '41222333',
          nombres: 'Marta Prueba',
          apellidos: 'Sintética',
          sexo: 'femenino',
          fechaNacimiento: '1990-01-01',
          telefono: null,
          direccion: null,
        },
      },
    ]);
  });

  it('muestra a la persona que ya está activa y no ofrece crear otra', async () => {
    conListas({
      'POST /beneficiarios/busqueda': json({
        persona: adulta,
        beneficiario: {
          tipoPoblacionId: 'tp-2',
          membresiaActiva: membresia('i-2'),
          representantes: [],
        },
      } satisfies FichaDeBeneficiario),
    });
    montar();

    buscar();

    expect(await screen.findByText('Ya está registrada: Ana Prueba Sintética')).toBeInTheDocument();
    expect(await screen.findByText(/Activa en Fundación El Refugio/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Registrar persona' })).toBeNull();
  });

  it('reutiliza a la beneficiaria sin membresía activa con su tipo de población', async () => {
    const fetch = conListas({
      'POST /beneficiarios/busqueda': json({
        persona: adulta,
        beneficiario: { tipoPoblacionId: 'tp-2', membresiaActiva: null, representantes: [] },
      } satisfies FichaDeBeneficiario),
      'POST /beneficiarios': json(creada, 201),
    });
    montar();

    buscar();
    await screen.findByRole('form', { name: 'Registrar persona' });
    expect(screen.queryByLabelText('Nombres')).toBeNull();
    expect(screen.queryByLabelText('Tipo de población')).toBeNull();
    await elegirSanJose();
    autorizar();
    registrar();

    await screen.findByText('Registrada en Parroquia San José.');
    expect(cuerpoDelAlta(fetch)).toMatchObject({
      persona: datosDeAdulta,
      tipoPoblacionId: 'tp-2',
    });
    expect(cuerpoDelAlta(fetch)?.persona).not.toHaveProperty('id');
  });

  it('a un menor con representante vigente no le pide otro', async () => {
    const menor: PersonaDto = {
      ...adulta,
      tipoDocumento: 'ti',
      fechaNacimiento: '2014-05-05',
    };
    const fetch = conListas({
      'POST /beneficiarios/busqueda': json({
        persona: menor,
        beneficiario: {
          tipoPoblacionId: 'tp-2',
          membresiaActiva: null,
          representantes: [
            {
              persona: { ...adulta, id: 'p-2', numeroDocumento: '41222333' },
              parentesco: 'madre',
            },
          ],
        },
      } satisfies FichaDeBeneficiario),
      'POST /beneficiarios': json(creada, 201),
    });
    montar();

    escribir('Tipo de documento', 'ti');
    buscar();
    await screen.findByRole('form', { name: 'Registrar persona' });
    expect(screen.queryByRole('group', { name: 'Representante legal' })).toBeNull();
    await elegirSanJose();
    autorizar();
    registrar();

    await screen.findByText('Registrada en Parroquia San José.');
    expect(cuerpoDelAlta(fetch)).not.toHaveProperty('representantes');
  });

  it('avisa cuando el número existe con otro tipo de documento', async () => {
    conListas({
      'POST /beneficiarios/busqueda': json({
        persona: { ...adulta, tipoDocumento: 'ti' },
        beneficiario: null,
      } satisfies FichaDeBeneficiario),
    });
    montar();

    buscar();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese número ya está registrado con otro tipo de documento.',
    );
    expect(screen.queryByText(/Ana Prueba/)).toBeNull();
    expect(screen.queryByRole('form', { name: 'Registrar persona' })).toBeNull();
  });

  it('al cambiar de documento no arrastra los datos de la persona encontrada', async () => {
    let ficha: FichaDeBeneficiario = {
      persona: adulta,
      beneficiario: { tipoPoblacionId: 'tp-1', membresiaActiva: null, representantes: [] },
    };
    conListas({ 'POST /beneficiarios/busqueda': () => json(ficha)() });
    montar();

    buscar();
    await screen.findByText('Ya está registrada: Ana Prueba Sintética');
    ficha = NADIE;
    buscar('900333444');

    await screen.findByLabelText('Nombres');
    expect(screen.getByLabelText('Nombres')).toHaveValue('');
  });

  it('al corregir el documento después de un no_existe borra lo llenado y la autorización', async () => {
    conListas({ 'POST /beneficiarios/busqueda': json(NADIE) });
    montar();

    buscar();
    await llenarAdulta();
    escribir('Tipo de población', 'tp-2');
    autorizar();
    buscar('900333444');

    await screen.findByRole('form', { name: 'Registrar persona' });
    expect(screen.getByLabelText('Nombres')).toHaveValue('');
    expect(screen.getByLabelText('Fecha de nacimiento')).toHaveValue('');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Tipo de población')).toHaveValue('tp-1');
  });

  it('no deja cambiar el documento mientras busca', async () => {
    let responder: (respuesta: Response) => void = () => {};
    conListas({
      'POST /beneficiarios/busqueda': () => new Promise<Response>((r) => (responder = r)),
    });
    montar();

    buscar();

    await waitFor(() => expect(screen.getByLabelText('Número de documento')).toBeDisabled());
    expect(screen.getByLabelText('Tipo de documento')).toBeDisabled();
    responder(new Response(JSON.stringify(NADIE)));
    await waitFor(() => expect(screen.getByLabelText('Número de documento')).toBeEnabled());
  });

  it('la siguiente persona vuelve al tipo de población de la institución', async () => {
    conListas({
      'POST /beneficiarios/busqueda': json(NADIE),
      'POST /beneficiarios': json(creada, 201),
    });
    montar();

    buscar();
    await llenarAdulta();
    escribir('Tipo de población', 'tp-2');
    autorizar();
    registrar();
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar otra persona' }));
    buscar('900333444');

    await screen.findByRole('form', { name: 'Registrar persona' });
    expect(screen.getByLabelText('Institución')).toHaveValue('i-1');
    expect(screen.getByLabelText('Tipo de población')).toHaveValue('tp-1');
  });

  it('la fecha de nacimiento no pasa del día local, aunque en UTC ya sea mañana', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 22, 23, 30));
    conListas({ 'POST /beneficiarios/busqueda': json(NADIE) });
    montar();

    buscar();

    expect(await screen.findByLabelText('Fecha de nacimiento')).toHaveAttribute(
      'max',
      '2026-10-22',
    );
  });

  it('dice si ya estaba activa en esa institución', async () => {
    conListas({
      'POST /beneficiarios/busqueda': json(NADIE),
      'POST /beneficiarios': json({ ...creada, resultado: 'ya_activa' }),
    });
    montar();

    buscar();
    await llenarAdulta();
    autorizar();
    registrar();

    expect(
      await screen.findByText('Ya estaba activa en Parroquia San José. No se creó otra membresía.'),
    ).toBeInTheDocument();
  });

  it('explica la duplicidad sin repetir el documento ni nombrar la otra institución', async () => {
    conListas({
      'POST /beneficiarios/busqueda': json(NADIE),
      'POST /beneficiarios': json(
        { codigo: 'duplicidad', message: `Documento ${DOCUMENTO} activo en Fundación El Refugio` },
        409,
      ),
    });
    montar();

    buscar();
    await llenarAdulta();
    autorizar();
    registrar();

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('ya está activa en otra institución');
    expect(document.body.textContent).not.toContain(DOCUMENTO);
    expect(alerta).not.toHaveTextContent('El Refugio');
  });

  it('ante un registro simultáneo pide volver a registrar', async () => {
    conListas({
      'POST /beneficiarios/busqueda': json(NADIE),
      'POST /beneficiarios': json({ codigo: 'registro_simultaneo', message: 'x' }, 409),
    });
    montar();

    buscar();
    await llenarAdulta();
    autorizar();
    registrar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Toca Registrar otra vez');
    expect(screen.getByRole('button', { name: 'Registrar' })).toBeInTheDocument();
  });

  it('sin conexión lo dice y no deja buscar', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    conListas({});
    montar();

    expect(screen.getByRole('status')).toHaveTextContent('El registro necesita señal');
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled();
  });

  it('si la red falla a mitad, dice que no se guardó', async () => {
    conListas({
      'POST /beneficiarios/busqueda': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    montar();

    buscar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó nada');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Buscar' })).not.toBeDisabled());
  });
});
