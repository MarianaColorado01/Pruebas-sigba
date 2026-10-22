import { ArrowRight01Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { ClaveParametro, ParametroListado } from '@sigba/shared-types';
import { type FormEvent, useState } from 'react';
import { ErrorDeApi } from '@/shared/clienteHttp';
import { tieneRol, useAsignacion } from '@/shared/sesion';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { mensajeDeError, useHistorialDeParametro, useParametros } from './datos.ts';
import { HojaDeEdicion } from '@/ui/HojaDeEdicion';
import {
  CLAVES_EN_PANTALLA,
  fechaLegible,
  hoyEnBogota,
  leerNumero,
  leerRangos,
  PARAMETROS,
  type RangoEnEdicion,
  rangosEnEdicion,
  valorLegible,
  vigenciaLegible,
} from './parametros.ts';

/**
 * Parámetros del banco con vigencia (SBA-87, RF-M3-04). Solo `admin_banco`,
 * como la API. Un cambio es una versión nueva desde hoy o una fecha posterior:
 * lo que ya rigió no se edita.
 */
export function PantallaParametros() {
  if (!tieneRol(useAsignacion(), ['admin_banco'])) {
    return (
      <main className="mx-auto max-w-2xl px-4 pt-6 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Los parámetros los administra el banco. Tu rol no tiene acceso a esta pantalla.
        </p>
      </main>
    );
  }
  return <ListaDeParametros />;
}

function ListaDeParametros() {
  const { vigentes } = useParametros();
  const [abierto, setAbierto] = useState<ClaveParametro | null>(null);
  const vigenteDe = (clave: ClaveParametro) => vigentes.data?.find((p) => p.clave === clave);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 pt-6 pb-24 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Parámetros</h1>
        <p className="text-sm text-muted-foreground">
          Cada cambio es una versión nueva que rige desde la fecha que elijas. Lo que ya rigió no se
          edita.
        </p>
      </header>

      {vigentes.isError && (
        <p role="alert" className="text-sm text-destructive">
          No se pudo cargar la lista. Revisa la señal y vuelve a intentarlo.
        </p>
      )}

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {CLAVES_EN_PANTALLA.map((clave) => {
          const vigente = vigenteDe(clave);
          return (
            <li key={clave}>
              <button
                type="button"
                onClick={() => setAbierto(clave)}
                className="flex min-h-16 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{PARAMETROS[clave].nombre}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {vigentes.isPending
                      ? 'Cargando…'
                      : vigente
                        ? valorLegible(vigente)
                        : 'Sin valor vigente'}
                  </span>
                </span>
                {vigente && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    desde el {fechaLegible(vigente.fecha_inicio)}
                  </span>
                )}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={18}
                  className="shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>

      {abierto && (
        <EdicionDeParametro
          key={abierto}
          clave={abierto}
          vigente={vigenteDe(abierto)}
          onCerrar={() => setAbierto(null)}
        />
      )}
    </main>
  );
}

/** El 409 trae el motivo de la vigencia; el 400, que el valor no cumple la regla de la ayuda. */
function mensajeAlGuardar(error: unknown): string {
  if (error instanceof ErrorDeApi && error.estado === 409) return error.message;
  if (error instanceof ErrorDeApi && error.estado === 400) {
    return 'El valor no cumple la regla del parámetro. Revisa la ayuda de arriba.';
  }
  return mensajeDeError(error, '');
}

function EdicionDeParametro({
  clave,
  vigente,
  onCerrar,
}: {
  clave: ClaveParametro;
  vigente: ParametroListado | undefined;
  onCerrar: () => void;
}) {
  const { programar } = useParametros();
  const historial = useHistorialDeParametro(clave);
  const definicion = PARAMETROS[clave];
  const hoy = hoyEnBogota();
  const [rangos, setRangos] = useState<RangoEnEdicion[]>(() =>
    vigente?.clave === 'rangos_etarios'
      ? rangosEnEdicion(vigente.valor)
      : [{ desde: '0', hasta: '' }],
  );
  const [error, setError] = useState<string | null>(null);

  async function guardar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const fechaInicio = String(datos.get('fechaInicio') ?? '');
    const valor = definicion.numero
      ? leerNumero(String(datos.get('valor') ?? ''))
      : leerRangos(rangos);

    if (valor === null) {
      setError(
        definicion.numero
          ? 'Escribe un número.'
          : 'Escribe las edades en años enteros. Deja «hasta» vacío solo en el último rango.',
      );
      return;
    }
    if (!fechaInicio || fechaInicio < hoy) {
      setError('Elige hoy o una fecha posterior. Lo que ya rigió no se edita.');
      return;
    }
    try {
      await programar.mutateAsync({ clave, valor, fechaInicio });
      onCerrar();
    } catch (causa) {
      setError(mensajeAlGuardar(causa));
    }
  }

  const versiones = [...(historial.data ?? [])].reverse();

  return (
    <HojaDeEdicion
      abierta
      onCerrar={onCerrar}
      titulo={definicion.nombre}
      descripcion={vigente ? vigenciaLegible(vigente, hoy) : 'Sin valor vigente'}
    >
      <p className="text-sm text-muted-foreground">{definicion.ayuda}</p>

      <form onSubmit={guardar} aria-label="Nueva versión" className="flex flex-col gap-4">
        {definicion.numero ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="parametro-valor">
              Valor nuevo{definicion.numero.unidad && ` (${definicion.numero.unidad})`}
            </Label>
            <Input
              id="parametro-valor"
              name="valor"
              inputMode="decimal"
              autoComplete="off"
              defaultValue={typeof vigente?.valor === 'number' ? String(vigente.valor) : ''}
            />
          </div>
        ) : (
          <EditorDeRangos rangos={rangos} onCambio={setRangos} />
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="parametro-desde">Rige desde</Label>
          <Input id="parametro-desde" name="fechaInicio" type="date" min={hoy} defaultValue={hoy} />
          <p className="text-xs text-muted-foreground">
            Si ya hay una versión programada para esa fecha, la reemplaza.
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={programar.isPending}>
          {programar.isPending ? 'Guardando…' : 'Guardar versión'}
        </Button>
      </form>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-sm font-medium">Historial</h2>
        {historial.isPending && <p className="text-sm text-muted-foreground">Cargando…</p>}
        {historial.isError && (
          <p role="alert" className="text-sm text-destructive">
            No se pudo cargar el historial.
          </p>
        )}
        {historial.isSuccess && versiones.length === 0 && (
          <p className="text-sm text-muted-foreground">Todavía no tiene versiones.</p>
        )}
        <ol className="flex flex-col gap-3">
          {versiones.map((version) => (
            <li key={version.version} className="flex flex-col">
              <span className="text-sm font-medium">{valorLegible(version)}</span>
              <span className="text-xs text-muted-foreground">
                Versión {version.version} · {vigenciaLegible(version, hoy)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </HojaDeEdicion>
  );
}

function EditorDeRangos({
  rangos,
  onCambio,
}: {
  rangos: RangoEnEdicion[];
  onCambio: (rangos: RangoEnEdicion[]) => void;
}) {
  const cambiar = (indice: number, campo: keyof RangoEnEdicion, texto: string) =>
    onCambio(rangos.map((rango, i) => (i === indice ? { ...rango, [campo]: texto } : rango)));

  function agregar() {
    const tope = leerNumero(rangos.at(-1)?.hasta ?? '');
    onCambio([...rangos, { desde: tope === null ? '' : String(tope + 1), hasta: '' }]);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Rangos nuevos (años)</legend>
      {rangos.map((rango, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`Desde, rango ${i + 1}`}
            inputMode="numeric"
            value={rango.desde}
            onChange={(e) => cambiar(i, 'desde', e.target.value)}
          />
          <span className="text-sm text-muted-foreground">a</span>
          <Input
            aria-label={`Hasta, rango ${i + 1}`}
            inputMode="numeric"
            placeholder="sin tope"
            value={rango.hasta}
            onChange={(e) => cambiar(i, 'hasta', e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Quitar rango ${i + 1}`}
            disabled={rangos.length === 1}
            onClick={() => onCambio(rangos.filter((_, j) => j !== i))}
          >
            <HugeiconsIcon icon={Cancel01Icon} aria-hidden />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={agregar}>
        Agregar rango
      </Button>
    </fieldset>
  );
}
