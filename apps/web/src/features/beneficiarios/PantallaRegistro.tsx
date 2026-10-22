import { type FormEvent, type ReactNode, useState } from 'react';
import { useEstadoDeConexion } from '@/offline/useEstadoDeConexion.ts';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  AVISO_DE_PRIVACIDAD,
  type BeneficiarioRegistrado,
  type DatosDePersona,
  PARENTESCOS,
  type Parentesco,
  type PersonaDto,
  SEXOS,
  type Sexo,
  type TipoDeDocumento,
} from '@sigba/shared-types';
import {
  edad,
  esMenor,
  fechaLocal,
  mensajeDeError,
  useBuscarPersona,
  useInstituciones,
  useRegistrar,
  useTiposDePoblacion,
} from './datos.ts';

/** En el orden del selector: los más comunes primero. */
const NOMBRE_DE_DOCUMENTO: Record<TipoDeDocumento, string> = {
  cc: 'Cédula de ciudadanía',
  ti: 'Tarjeta de identidad',
  registro_civil: 'Registro civil',
  ce: 'Cédula de extranjería',
  ppt: 'Permiso por protección temporal (PPT)',
  pep: 'Permiso especial de permanencia (PEP)',
  pasaporte: 'Pasaporte',
};

const DOCUMENTOS = Object.keys(NOMBRE_DE_DOCUMENTO) as TipoDeDocumento[];
const DE_ADULTOS = DOCUMENTOS.filter((t) => t !== 'ti' && t !== 'registro_civil');

const NOMBRE_DE_SEXO: Record<Sexo, string> = {
  masculino: 'Masculino',
  femenino: 'Femenino',
  prefiero_no_decirlo: 'Prefiere no decirlo',
};

const NOMBRE_DE_PARENTESCO: Record<Parentesco, string> = {
  madre: 'Madre',
  padre: 'Padre',
  padrastro_madrastra: 'Padrastro o madrastra',
  abuelo_a: 'Abuelo o abuela',
  bisabuelo_a: 'Bisabuelo o bisabuela',
  hermano_a: 'Hermano o hermana',
  hermanastro_a: 'Hermanastro o hermanastra',
  tio_a: 'Tío o tía',
  tio_abuelo_a: 'Tío abuelo o tía abuela',
  primo_a: 'Primo o prima',
  cunado_a: 'Cuñado o cuñada',
  sobrino_a: 'Sobrino o sobrina',
  tutor_legal: 'Tutor legal',
  otro: 'Otro',
};

type Campos = Omit<DatosDePersona, 'sexo' | 'telefono' | 'direccion'> & {
  sexo: Sexo | '';
  telefono: string;
  direccion: string;
};

const VACIA = (tipoDocumento: TipoDeDocumento): Campos => ({
  tipoDocumento,
  numeroDocumento: '',
  nombres: '',
  apellidos: '',
  sexo: '',
  fechaNacimiento: '',
  telefono: '',
  direccion: '',
});

/** Lo que llega de la búsqueda, sin el `id`: el alta reutiliza por documento. */
function aCampos({ id: _id, telefono, direccion, ...resto }: PersonaDto): Campos {
  return { ...resto, telefono: telefono ?? '', direccion: direccion ?? '' };
}

function aDatos(campos: Campos): DatosDePersona {
  return {
    ...campos,
    sexo: campos.sexo as Sexo,
    nombres: campos.nombres.trim(),
    apellidos: campos.apellidos.trim(),
    numeroDocumento: campos.numeroDocumento.trim(),
    telefono: campos.telefono.trim() || null,
    direccion: campos.direccion.trim() || null,
  };
}

const SELECT = 'h-11 w-full rounded-md border border-input bg-input/20 px-3 text-base md:text-sm';

/**
 * Registro nominal de una persona en una sola pantalla (SBA-78, RNF-M2-08).
 * Primero se busca el documento: si la persona ya existe, se reutiliza y no
 * se crea otra (SBA-27). Un menor sin representante vigente necesita uno
 * (RF-M2-07).
 *
 * Solo en línea. Los datos viven en el estado del formulario y se pierden al
 * salir: nada va a IndexedDB, localStorage ni la caché offline (Arquitectura
 * 8.6). `autoComplete="off"` evita que el navegador los guarde para autollenar.
 */
export function PantallaRegistro() {
  const conectado = useEstadoDeConexion();
  const instituciones = useInstituciones();
  const tipos = useTiposDePoblacion();
  const buscar = useBuscarPersona();
  const registrar = useRegistrar();

  const [persona, setPersona] = useState<Campos>(VACIA('cc'));
  const [institucionId, setInstitucionId] = useState('');
  const [tipoPoblacionId, setTipoPoblacionId] = useState('');
  const [consentimiento, setConsentimiento] = useState(false);
  const [representante, setRepresentante] = useState<Campos>(VACIA('cc'));
  const [parentesco, setParentesco] = useState<Parentesco | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<BeneficiarioRegistrado | null>(null);

  const ficha = buscar.data;
  const encontrada = ficha?.persona ?? null;
  const beneficiario = ficha?.beneficiario ?? null;
  // La búsqueda va solo por número; el tipo lo compara la pantalla, como el alta.
  const tipoDistinto = encontrada !== null && encontrada.tipoDocumento !== persona.tipoDocumento;
  const activa = beneficiario?.membresiaActiva ?? null;
  const nueva = ficha !== undefined && encontrada === null;
  const puedeRegistrar = ficha !== undefined && !tipoDistinto && !activa;
  const pideRepresentante =
    puedeRegistrar &&
    esMenor(persona.tipoDocumento, persona.fechaNacimiento) &&
    !beneficiario?.representantes.length;
  const nombreDe = (id: string) =>
    instituciones.data?.find((i) => i.id === id)?.nombre ?? 'otra institución';

  /** Cada institución atiende un tipo de población (D8): se propone ese. */
  const tipoDe = (id: string) => instituciones.data?.find((i) => i.id === id)?.tipoPoblacionId;

  /**
   * Borra todo lo que depende de la persona: sus datos, representante,
   * consentimiento y tipo de población. La institución se conserva.
   */
  function olvidarPersona(documento: Pick<Campos, 'tipoDocumento' | 'numeroDocumento'>) {
    setPersona({ ...VACIA(documento.tipoDocumento), numeroDocumento: documento.numeroDocumento });
    setRepresentante(VACIA('cc'));
    setParentesco('');
    setConsentimiento(false);
    setTipoPoblacionId(tipoDe(institucionId) ?? '');
    setError(null);
    buscar.reset();
  }

  /** Otro documento es otra búsqueda: nada de lo llenado para el anterior se queda. */
  function cambiarDocumento(cambios: Partial<Campos>) {
    olvidarPersona({ ...persona, ...cambios });
  }

  function elegirInstitucion(id: string) {
    setInstitucionId(id);
    setTipoPoblacionId(tipoDe(id) ?? '');
  }

  function empezarOtra() {
    olvidarPersona(VACIA('cc'));
    setHecho(null);
    registrar.reset();
  }

  async function alBuscar(evento: FormEvent) {
    evento.preventDefault();
    setError(null);
    if (!persona.numeroDocumento.trim()) return setError('Escribe el número de documento.');
    try {
      const { persona: hallada } = await buscar.mutateAsync({
        numeroDocumento: persona.numeroDocumento.trim(),
      });
      // La persona encontrada llena el formulario y no se edita aquí.
      if (hallada && hallada.tipoDocumento === persona.tipoDocumento) setPersona(aCampos(hallada));
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  function faltante(): string | null {
    if (nueva) {
      if (!persona.nombres.trim() || !persona.apellidos.trim())
        return 'Faltan nombres o apellidos.';
      if (!persona.sexo) return 'Elige el sexo.';
      if (!persona.fechaNacimiento) return 'Falta la fecha de nacimiento.';
    }
    if (!institucionId) return 'Elige la institución.';
    if (!beneficiario && !tipoPoblacionId) return 'Elige el tipo de población.';
    if (pideRepresentante) {
      const r = representante;
      if (!r.numeroDocumento.trim() || !r.nombres.trim() || !r.apellidos.trim() || !r.sexo)
        return 'Completa los datos del representante legal.';
      if (!r.fechaNacimiento || edad(r.fechaNacimiento) < 18)
        return 'El representante legal debe ser mayor de edad.';
      if (!parentesco) return 'Elige el parentesco del representante.';
    }
    if (!consentimiento)
      return 'Sin la autorización de tratamiento de datos no se puede registrar.';
    return null;
  }

  async function alRegistrar(evento: FormEvent) {
    evento.preventDefault();
    const motivo = faltante();
    if (motivo) return setError(motivo);
    setError(null);
    try {
      setHecho(
        await registrar.mutateAsync({
          institucionId,
          // Quien ya es beneficiaria conserva su tipo: la API ignora el que llegue.
          tipoPoblacionId: beneficiario?.tipoPoblacionId ?? tipoPoblacionId,
          persona: aDatos(persona),
          ...(pideRepresentante && parentesco
            ? { representantes: [{ persona: aDatos(representante), parentesco }] }
            : {}),
          consentimiento: { otorgado: true, versionAviso: AVISO_DE_PRIVACIDAD.version },
        }),
      );
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  if (hecho) {
    return (
      <Marco>
        <section role="status" className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <p className="font-medium">
            {hecho.resultado === 'creada'
              ? `Registrada en ${nombreDe(hecho.membresia.institucionId)}.`
              : `Ya estaba activa en ${nombreDe(hecho.membresia.institucionId)}. No se creó otra membresía.`}
          </p>
          <p className="text-sm text-muted-foreground">
            {persona.nombres} {persona.apellidos}
          </p>
        </section>
        <Button size="lg" onClick={empezarOtra}>
          Registrar otra persona
        </Button>
      </Marco>
    );
  }

  const ocupado = buscar.isPending || registrar.isPending;

  return (
    <Marco>
      {!conectado && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          Sin conexión. El registro necesita señal: los datos de las personas no se guardan en el
          celular.
        </p>
      )}

      <form
        aria-label="Buscar documento"
        autoComplete="off"
        onSubmit={alBuscar}
        className="flex flex-col gap-3"
      >
        <Campo id="tipo-documento" etiqueta="Tipo de documento">
          <select
            id="tipo-documento"
            className={SELECT}
            value={persona.tipoDocumento}
            disabled={buscar.isPending}
            onChange={(e) => cambiarDocumento({ tipoDocumento: e.target.value as TipoDeDocumento })}
          >
            {DOCUMENTOS.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_DE_DOCUMENTO[t]}
              </option>
            ))}
          </select>
        </Campo>
        <div className="flex items-end gap-2">
          <Campo id="numero-documento" etiqueta="Número de documento" className="flex-1">
            <Input
              id="numero-documento"
              value={persona.numeroDocumento}
              // Mientras busca, el documento no cambia: la respuesta siempre es la del que se ve.
              disabled={buscar.isPending}
              inputMode={
                /^(cc|ti|registro_civil)$/.test(persona.tipoDocumento) ? 'numeric' : 'text'
              }
              maxLength={20}
              onChange={(e) => cambiarDocumento({ numeroDocumento: e.target.value })}
            />
          </Campo>
          {!ficha && (
            <Button type="submit" disabled={!conectado || ocupado}>
              {buscar.isPending ? 'Buscando…' : 'Buscar'}
            </Button>
          )}
        </div>
      </form>

      {tipoDistinto && (
        <p role="alert" className="text-sm text-destructive">
          Ese número ya está registrado con otro tipo de documento. Revisa el tipo; si está bien, el
          caso lo resuelve coordinación.
        </p>
      )}

      {encontrada && !tipoDistinto && (
        <section className="flex flex-col gap-1 rounded-xl border bg-card p-4">
          <p className="font-medium">
            Ya está registrada: {encontrada.nombres} {encontrada.apellidos}
          </p>
          <p className="text-sm text-muted-foreground">
            {activa
              ? `Activa en ${nombreDe(activa.institucionId)}. No hace falta registrarla de nuevo.`
              : beneficiario
                ? 'Sin membresía activa. Elige la institución para activarla; no se crea otra persona.'
                : 'Está registrada como representante de un menor. Complétala como beneficiaria; no se crea otra persona.'}
          </p>
        </section>
      )}

      {puedeRegistrar && (
        <form
          aria-label="Registrar persona"
          autoComplete="off"
          onSubmit={alRegistrar}
          className="flex flex-col gap-4"
        >
          {nueva && <CamposDePersona prefijo="persona" campos={persona} onCambio={setPersona} />}

          <Campo id="institucion" etiqueta="Institución">
            <select
              id="institucion"
              className={SELECT}
              value={institucionId}
              onChange={(e) => elegirInstitucion(e.target.value)}
            >
              <option value="" disabled>
                {instituciones.isPending ? 'Cargando…' : 'Elige la institución'}
              </option>
              {instituciones.data?.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre}
                </option>
              ))}
            </select>
          </Campo>

          {!beneficiario && (
            <Campo id="tipo-poblacion" etiqueta="Tipo de población">
              <select
                id="tipo-poblacion"
                className={SELECT}
                value={tipoPoblacionId}
                onChange={(e) => setTipoPoblacionId(e.target.value)}
              >
                <option value="" disabled>
                  {tipos.isPending ? 'Cargando…' : 'Elige el tipo de población'}
                </option>
                {tipos.data
                  ?.filter((t) => t.activo)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
              </select>
            </Campo>
          )}

          {pideRepresentante && (
            <fieldset className="flex flex-col gap-4 rounded-xl border p-4">
              <legend className="px-1 font-medium">Representante legal</legend>
              <p className="text-sm text-muted-foreground">
                Es menor de edad. Registra a la persona adulta que la representa; no necesita ser
                beneficiaria.
              </p>
              <Campo id="representante-tipo" etiqueta="Tipo de documento">
                <select
                  id="representante-tipo"
                  className={SELECT}
                  value={representante.tipoDocumento}
                  onChange={(e) =>
                    setRepresentante({
                      ...representante,
                      tipoDocumento: e.target.value as TipoDeDocumento,
                    })
                  }
                >
                  {DE_ADULTOS.map((t) => (
                    <option key={t} value={t}>
                      {NOMBRE_DE_DOCUMENTO[t]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo id="representante-numero" etiqueta="Número de documento">
                <Input
                  id="representante-numero"
                  value={representante.numeroDocumento}
                  maxLength={20}
                  onChange={(e) =>
                    setRepresentante({ ...representante, numeroDocumento: e.target.value })
                  }
                />
              </Campo>
              <CamposDePersona
                prefijo="representante"
                campos={representante}
                onCambio={setRepresentante}
              />
              <Campo id="parentesco" etiqueta="Parentesco">
                <select
                  id="parentesco"
                  className={SELECT}
                  value={parentesco}
                  onChange={(e) => setParentesco(e.target.value as Parentesco)}
                >
                  <option value="" disabled>
                    Elige el parentesco
                  </option>
                  {PARENTESCOS.map((p) => (
                    <option key={p} value={p}>
                      {NOMBRE_DE_PARENTESCO[p]}
                    </option>
                  ))}
                </select>
              </Campo>
            </fieldset>
          )}

          <label className="flex items-start gap-3 rounded-xl border p-4">
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0"
              checked={consentimiento}
              onChange={(e) => setConsentimiento(e.target.checked)}
            />
            <span className="flex flex-col gap-1">
              <span className="font-medium">
                {pideRepresentante ? 'El representante autorizó' : 'La persona autorizó'} el
                tratamiento de sus datos
              </span>
              <span className="text-sm">Finalidad: {AVISO_DE_PRIVACIDAD.finalidad}</span>
              <span className="text-sm text-muted-foreground">
                Aviso de privacidad {AVISO_DE_PRIVACIDAD.version}. Queda registrado que lo recogiste
                tú, hoy.
              </span>
            </span>
          </label>

          {error && <Aviso>{error}</Aviso>}

          <Button type="submit" size="lg" disabled={!conectado || ocupado}>
            {registrar.isPending ? 'Guardando…' : 'Registrar'}
          </Button>
        </form>
      )}

      {ficha && !puedeRegistrar && (
        <Button variant="outline" size="lg" onClick={empezarOtra}>
          Buscar otro documento
        </Button>
      )}
      {!puedeRegistrar && error && <Aviso>{error}</Aviso>}
    </Marco>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Registrar persona</h1>
        <p className="text-sm text-muted-foreground">Busca el documento antes de registrar.</p>
      </header>
      {children}
    </main>
  );
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}

function Campo({
  id,
  etiqueta,
  className,
  children,
}: {
  id: string;
  etiqueta: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
    </div>
  );
}

/** Nombres, sexo, nacimiento y contacto: los mismos para la persona y su representante. */
function CamposDePersona({
  prefijo,
  campos,
  onCambio,
}: {
  prefijo: string;
  campos: Campos;
  onCambio: (campos: Campos) => void;
}) {
  const cambiar = (cambios: Partial<Campos>) => onCambio({ ...campos, ...cambios });
  const hoy = fechaLocal();

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={`${prefijo}-nombres`} etiqueta="Nombres">
          <Input
            id={`${prefijo}-nombres`}
            value={campos.nombres}
            maxLength={100}
            autoCapitalize="words"
            onChange={(e) => cambiar({ nombres: e.target.value })}
          />
        </Campo>
        <Campo id={`${prefijo}-apellidos`} etiqueta="Apellidos">
          <Input
            id={`${prefijo}-apellidos`}
            value={campos.apellidos}
            maxLength={100}
            autoCapitalize="words"
            onChange={(e) => cambiar({ apellidos: e.target.value })}
          />
        </Campo>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Sexo</legend>
        <div className="grid grid-cols-3 gap-2">
          {SEXOS.map((s) => (
            <label
              key={s}
              className="flex min-h-11 items-center justify-center rounded-md border px-2 text-center text-sm has-checked:border-primary has-checked:bg-primary/10 has-checked:font-medium"
            >
              <input
                type="radio"
                name={`${prefijo}-sexo`}
                value={s}
                className="sr-only"
                checked={campos.sexo === s}
                onChange={() => cambiar({ sexo: s })}
              />
              {NOMBRE_DE_SEXO[s]}
            </label>
          ))}
        </div>
      </fieldset>

      <Campo id={`${prefijo}-nacimiento`} etiqueta="Fecha de nacimiento">
        <Input
          id={`${prefijo}-nacimiento`}
          type="date"
          max={hoy}
          value={campos.fechaNacimiento}
          onChange={(e) => cambiar({ fechaNacimiento: e.target.value })}
        />
      </Campo>

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={`${prefijo}-telefono`} etiqueta="Teléfono (opcional)">
          <Input
            id={`${prefijo}-telefono`}
            type="tel"
            inputMode="tel"
            value={campos.telefono}
            maxLength={30}
            onChange={(e) => cambiar({ telefono: e.target.value })}
          />
        </Campo>
        <Campo id={`${prefijo}-direccion`} etiqueta="Dirección (opcional)">
          <Input
            id={`${prefijo}-direccion`}
            value={campos.direccion}
            maxLength={500}
            onChange={(e) => cambiar({ direccion: e.target.value })}
          />
        </Campo>
      </div>
    </>
  );
}
