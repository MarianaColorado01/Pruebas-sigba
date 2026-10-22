import { Add01Icon, ArrowRight01Icon, Building03Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { InstitucionDto, TipoDePoblacionDto } from '@sigba/shared-types';
import { type FormEvent, type ReactNode, useState } from 'react';
import { ErrorDeApi } from '@/shared/clienteHttp';
import { HojaDeEdicion } from '@/ui/HojaDeEdicion';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import {
  type DatosDeInstitucion,
  mensajeDeError,
  NOMBRE_DE_DIA,
  NOMBRE_DE_TIPO,
  normalizar,
  useInstituciones,
  useTiposDePoblacion,
} from './instituciones.ts';

const CLASE_DE_SELECT =
  'h-11 w-full rounded-md border border-input bg-input/20 px-3 text-base md:text-sm dark:bg-input/30';

/** `null`: hoja cerrada. `'nueva'`: alta. Una institución: su edición. */
type Hoja = null | 'nueva' | InstitucionDto;

/**
 * Directorio de instituciones del banco (SBA-86, RF-M2-01). La API solo deja
 * entrar a administración del banco y coordinación, y las dos pueden cambiarlo:
 * no hay vista de solo lectura.
 */
export function PantallaInstituciones() {
  const { lista } = useInstituciones();
  const tipos = useTiposDePoblacion();
  const [texto, setTexto] = useState('');
  const [verTodas, setVerTodas] = useState(false);
  const [hoja, setHoja] = useState<Hoja>(null);

  const instituciones = lista.data ?? [];
  const activas = instituciones.filter((i) => i.activa).length;
  const inactivas = instituciones.length - activas;
  const buscado = normalizar(texto);
  const visibles = instituciones.filter(
    (i) =>
      (verTodas || i.activa) &&
      (!buscado || normalizar(`${i.nombre} ${i.contactoNombre}`).includes(buscado)),
  );

  if (lista.error instanceof ErrorDeApi && lista.error.estado === 403) {
    return (
      <Marco>
        <p className="text-sm text-muted-foreground">
          Solo la administración del banco y coordinación ven el directorio de instituciones.
        </p>
      </Marco>
    );
  }

  return (
    <Marco
      resumen={
        lista.isPending
          ? 'Cargando…'
          : `${activas} ${activas === 1 ? 'activa' : 'activas'}` +
            (inactivas ? ` · ${inactivas} ${inactivas === 1 ? 'inactiva' : 'inactivas'}` : '')
      }
      accion={
        <Button onClick={() => setHoja('nueva')}>
          <HugeiconsIcon icon={Add01Icon} aria-hidden />
          Nueva
        </Button>
      }
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          aria-label="Buscar institución"
          placeholder="Buscar por nombre o contacto"
          autoComplete="off"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
        />
        {inactivas > 0 && (
          <div
            role="group"
            aria-label="Qué instituciones mostrar"
            className="flex shrink-0 rounded-lg bg-muted p-1"
          >
            {[
              { valor: false, texto: 'Activas' },
              { valor: true, texto: 'Todas' },
            ].map(({ valor, texto }) => (
              <button
                key={texto}
                type="button"
                aria-pressed={verTodas === valor}
                onClick={() => setVerTodas(valor)}
                className="min-h-11 flex-1 rounded-md px-4 text-sm font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
              >
                {texto}
              </button>
            ))}
          </div>
        )}
      </div>

      {lista.isError && (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cargar la lista. Revisa la señal y vuelve a intentarlo.
        </p>
      )}

      {lista.isSuccess && (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {visibles.map((institucion) => (
            <li key={institucion.id}>
              <FilaDeInstitucion institucion={institucion} onAbrir={() => setHoja(institucion)} />
            </li>
          ))}
          {visibles.length === 0 && (
            <li className="px-4 py-6 text-sm text-muted-foreground">
              {instituciones.length === 0
                ? 'El banco aún no tiene instituciones. Agrega la primera con «Nueva».'
                : 'Ninguna institución coincide con la búsqueda.'}
            </li>
          )}
        </ul>
      )}

      {hoja && (
        <HojaDeInstitucion
          key={hoja === 'nueva' ? 'nueva' : hoja.id}
          institucion={
            hoja === 'nueva' ? null : (instituciones.find((i) => i.id === hoja.id) ?? hoja)
          }
          tipos={tipos.data ?? []}
          onCerrar={() => setHoja(null)}
        />
      )}
    </Marco>
  );
}

function Marco({
  resumen,
  accion,
  children,
}: {
  resumen?: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pt-6 pb-24 sm:px-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Instituciones</h1>
          {resumen && <p className="text-sm text-muted-foreground">{resumen}</p>}
        </div>
        {accion}
      </header>
      {children}
    </main>
  );
}

function FilaDeInstitucion({
  institucion,
  onAbrir,
}: {
  institucion: InstitucionDto;
  onAbrir: () => void;
}) {
  const { activa, nombre, tipo, diaRecogida } = institucion;
  const detalle = [
    NOMBRE_DE_TIPO[tipo],
    diaRecogida && `Recoge los ${NOMBRE_DE_DIA[diaRecogida].toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onAbrir}
      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
    >
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-full ${
          activa ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        }`}
      >
        <HugeiconsIcon icon={Building03Icon} size={16} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-medium ${activa ? '' : 'text-muted-foreground'}`}>
          {nombre}
        </span>
        <span className="truncate text-sm text-muted-foreground">{detalle}</span>
      </span>
      {!activa && (
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          Inactiva
        </span>
      )}
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={18}
        className="text-muted-foreground"
        aria-hidden
      />
    </button>
  );
}

/** Lee el formulario. Devuelve los datos o qué falta. */
function leer(formulario: HTMLFormElement): DatosDeInstitucion | string {
  const datos = new FormData(formulario);
  const campo = (nombre: string) => String(datos.get(nombre) ?? '').trim();
  const opcional = (nombre: string) => campo(nombre) || null;

  const faltan = [
    !campo('nombre') && 'nombre',
    !campo('tipo') && 'tipo',
    !campo('tipoPoblacionId') && 'población que atiende',
    !campo('contactoNombre') && 'persona de contacto',
  ].filter(Boolean);
  if (faltan.length) return `Falta: ${faltan.join(', ')}.`;

  return {
    nombre: campo('nombre'),
    tipo: campo('tipo') as DatosDeInstitucion['tipo'],
    tipoPoblacionId: campo('tipoPoblacionId'),
    contactoNombre: campo('contactoNombre'),
    contactoTelefono: opcional('contactoTelefono'),
    contactoCorreo: opcional('contactoCorreo'),
    direccion: opcional('direccion'),
    diaRecogida: opcional('diaRecogida') as DatosDeInstitucion['diaRecogida'],
  };
}

function HojaDeInstitucion({
  institucion,
  tipos,
  onCerrar,
}: {
  institucion: InstitucionDto | null;
  tipos: TipoDePoblacionDto[];
  onCerrar: () => void;
}) {
  const { crear, editar } = useInstituciones();
  const [error, setError] = useState<string | null>(null);
  const guardando = crear.isPending || editar.isPending;

  // Los inactivos no se ofrecen, salvo el que ya tiene la institución.
  const opciones = tipos.filter((t) => t.activo || t.id === institucion?.tipoPoblacionId);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = leer(evento.currentTarget);
    if (typeof datos === 'string') {
      setError(datos);
      return;
    }
    try {
      if (institucion) await editar.mutateAsync({ id: institucion.id, datos });
      else await crear.mutateAsync(datos);
      onCerrar();
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  }

  return (
    <HojaDeEdicion
      abierta
      onCerrar={onCerrar}
      titulo={institucion?.nombre ?? 'Nueva institución'}
      descripcion={
        !institucion
          ? 'Queda activa y se ofrece como destino de salidas.'
          : institucion.activa
            ? 'Activa'
            : 'Inactiva: no se ofrece como destino de salidas nuevas.'
      }
    >
      <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
        <Campo id="institucion-nombre" etiqueta="Nombre">
          <Input
            id="institucion-nombre"
            name="nombre"
            defaultValue={institucion?.nombre}
            maxLength={200}
            autoComplete="off"
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="institucion-tipo" etiqueta="Tipo">
            <select
              id="institucion-tipo"
              name="tipo"
              defaultValue={institucion?.tipo ?? ''}
              className={CLASE_DE_SELECT}
            >
              <option value="" disabled>
                Elige uno
              </option>
              {Object.entries(NOMBRE_DE_TIPO).map(([valor, nombre]) => (
                <option key={valor} value={valor}>
                  {nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo id="institucion-poblacion" etiqueta="Población que atiende">
            <select
              id="institucion-poblacion"
              name="tipoPoblacionId"
              defaultValue={institucion?.tipoPoblacionId ?? ''}
              className={CLASE_DE_SELECT}
            >
              <option value="" disabled>
                {tipos.length ? 'Elige uno' : 'Cargando…'}
              </option>
              {opciones.map((tipo) => (
                <option key={tipo.id} value={tipo.id}>
                  {tipo.nombre}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <Campo id="institucion-contacto" etiqueta="Persona de contacto">
          <Input
            id="institucion-contacto"
            name="contactoNombre"
            defaultValue={institucion?.contactoNombre}
            maxLength={200}
            autoComplete="off"
          />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="institucion-telefono" etiqueta="Teléfono (opcional)">
            <Input
              id="institucion-telefono"
              name="contactoTelefono"
              type="tel"
              inputMode="tel"
              defaultValue={institucion?.contactoTelefono ?? ''}
              maxLength={30}
              autoComplete="off"
            />
          </Campo>
          <Campo id="institucion-correo" etiqueta="Correo (opcional)">
            <Input
              id="institucion-correo"
              name="contactoCorreo"
              type="email"
              inputMode="email"
              defaultValue={institucion?.contactoCorreo ?? ''}
              maxLength={200}
              autoComplete="off"
            />
          </Campo>
        </div>
        <Campo id="institucion-direccion" etiqueta="Dirección (opcional)">
          <Input
            id="institucion-direccion"
            name="direccion"
            defaultValue={institucion?.direccion ?? ''}
            maxLength={500}
            autoComplete="off"
          />
        </Campo>
        <Campo id="institucion-dia" etiqueta="Día de recogida">
          <select
            id="institucion-dia"
            name="diaRecogida"
            defaultValue={institucion?.diaRecogida ?? ''}
            className={CLASE_DE_SELECT}
          >
            <option value="">Sin día fijo</option>
            {Object.entries(NOMBRE_DE_DIA).map(([valor, nombre]) => (
              <option key={valor} value={valor}>
                {nombre}
              </option>
            ))}
          </select>
        </Campo>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : institucion ? 'Guardar cambios' : 'Agregar institución'}
        </Button>
      </form>

      {institucion?.activa && <Desactivar id={institucion.id} onError={setError} />}
    </HojaDeEdicion>
  );
}

function Campo({ id, etiqueta, children }: { id: string; etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
    </div>
  );
}

/**
 * Pide confirmar porque no tiene vuelta desde aquí: la API todavía no tiene
 * cómo reactivar una institución.
 */
function Desactivar({ id, onError }: { id: string; onError: (mensaje: string) => void }) {
  const { desactivar } = useInstituciones();
  const [confirmando, setConfirmando] = useState(false);

  async function confirmar() {
    try {
      await desactivar.mutateAsync(id);
      setConfirmando(false);
    } catch (causa) {
      onError(mensajeDeError(causa));
    }
  }

  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <p className="text-sm text-muted-foreground">
        {confirmando
          ? 'Deja de ofrecerse para salidas nuevas y hoy no se puede reactivar desde la aplicación. Las salidas que ya tiene se conservan.'
          : 'Si ya no recibe alimentos del banco, desactívala. No se borra.'}
      </p>
      {confirmando ? (
        <div className="flex gap-2">
          <Button variant="destructive" disabled={desactivar.isPending} onClick={confirmar}>
            {desactivar.isPending ? 'Desactivando…' : 'Sí, desactivar'}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setConfirmando(true)}>
          Desactivar institución
        </Button>
      )}
    </section>
  );
}
