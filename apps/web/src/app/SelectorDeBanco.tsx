import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Logout01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { AsignacionDeUsuario } from '@sigba/shared-types';
import type { ReactNode } from 'react';
import { Button } from '@/ui/button';
import { claveDe, NOMBRE_DE_ROL, nombreDeOpcion } from './eleccionDeBanco.ts';

/**
 * Marco de las pantallas previas a tener banco: cargando, error, sin acceso y
 * selector. Alineado arriba y a la izquierda, como una lista de Things: en el
 * celular el pulgar llega a las opciones sin estirarse.
 */
export function PantallaDeAcceso({
  titulo,
  ocupada = false,
  children,
}: {
  titulo: string;
  ocupada?: boolean;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 pt-[max(3rem,env(safe-area-inset-top))] pb-8">
      <p className="text-sm font-semibold tracking-tight text-muted-foreground">SIGBA</p>
      <h1 className="text-2xl font-semibold tracking-tight" role={ocupada ? 'status' : undefined}>
        {titulo}
      </h1>
      {children}
    </main>
  );
}

export function CerrarSesion({ alPulsar }: { alPulsar: () => void }) {
  return (
    <Button variant="ghost" className="self-start" onClick={alPulsar}>
      <HugeiconsIcon icon={Logout01Icon} aria-hidden />
      Cerrar sesión
    </Button>
  );
}

export function SinAcceso({ alCerrarSesion }: { alCerrarSesion: () => void }) {
  return (
    <PantallaDeAcceso titulo="Tu cuenta aún no tiene acceso a un banco; pide una invitación">
      <p className="text-muted-foreground">
        Pídela a quien administra el banco. Te llegará un enlace: ábrelo con esta misma cuenta.
      </p>
      <CerrarSesion alPulsar={alCerrarSesion} />
    </PantallaDeAcceso>
  );
}

/**
 * Inicial del banco, como el cuadro de espacio de trabajo de Linear. Se toma
 * de la última palabra: casi todos empiezan por «Banco de», y la ciudad es lo
 * que los distingue.
 */
export function InsigniaDeBanco({ opcion }: { opcion: AsignacionDeUsuario }) {
  return (
    <span
      aria-hidden
      className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-sm font-semibold text-primary-foreground"
    >
      {nombreDeOpcion(opcion).trim().split(/\s+/).at(-1)?.charAt(0).toUpperCase()}
    </span>
  );
}

export function SelectorDeBanco({
  opciones,
  actual,
  alElegir,
  alVolver,
  alCerrarSesion,
}: {
  opciones: readonly AsignacionDeUsuario[];
  actual: AsignacionDeUsuario | null;
  alElegir: (opcion: AsignacionDeUsuario) => void;
  alVolver?: () => void;
  alCerrarSesion: () => void;
}) {
  return (
    <PantallaDeAcceso titulo="¿Con qué banco trabajas hoy?">
      <ul aria-label="Tus bancos" className="-mx-1 flex flex-col">
        {opciones.map((opcion) => {
          const esActual = actual !== null && claveDe(actual) === claveDe(opcion);
          return (
            <li key={claveDe(opcion)}>
              <button
                type="button"
                onClick={() => alElegir(opcion)}
                aria-current={esActual ? 'true' : undefined}
                className="flex min-h-16 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 active:bg-muted"
              >
                <InsigniaDeBanco opcion={opcion} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{nombreDeOpcion(opcion)}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {NOMBRE_DE_ROL[opcion.rol]}
                  </span>
                </span>
                <HugeiconsIcon
                  icon={esActual ? Tick02Icon : ArrowRight01Icon}
                  size={20}
                  className="text-muted-foreground"
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-wrap gap-3">
        {alVolver && actual && (
          <Button variant="outline" onClick={alVolver}>
            <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
            Seguir en {nombreDeOpcion(actual)}
          </Button>
        )}
        <CerrarSesion alPulsar={alCerrarSesion} />
      </div>
    </PantallaDeAcceso>
  );
}
