import {
  Add01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  Robot01Icon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { AccionDeAuditoria, RegistroDeAuditoria } from '@sigba/shared-types';
import { cn } from 'cn';
import { agruparPorDia, legible, nombreDeActor, queHizo, tituloDelDia } from './auditoria.ts';

const ICONOS: Record<AccionDeAuditoria, typeof Add01Icon> = {
  crear: Add01Icon,
  actualizar: PencilEdit02Icon,
  eliminar: Delete02Icon,
  leer: ViewIcon,
};

const HORA = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * Registros agrupados por día, del más reciente al más antiguo, como una
 * bitácora. Cada fila abre su detalle; el día queda pegado arriba al bajar.
 */
export function LineaDeTiempo({
  registros,
  seleccionado,
  alElegir,
}: {
  registros: readonly RegistroDeAuditoria[];
  seleccionado?: string;
  alElegir: (registro: RegistroDeAuditoria) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {agruparPorDia(registros).map(({ dia, registros: delDia }) => (
        <section key={dia} aria-labelledby={`dia-${dia}`}>
          <h2
            id={`dia-${dia}`}
            className="sticky top-0 z-10 bg-background/95 py-2 text-sm font-semibold backdrop-blur"
          >
            {tituloDelDia(dia)}
            <span className="ml-2 font-normal text-muted-foreground tabular-nums">
              {delDia.length}
            </span>
          </h2>
          <ol className="relative ml-16 border-l border-border">
            {delDia.map((registro) => {
              const esSistema = registro.tipoActor === 'sistema';
              return (
                <li key={registro.id} className="relative">
                  <time
                    dateTime={registro.ocurridoEn}
                    className="absolute top-3 -left-16 w-12 text-right text-xs text-muted-foreground tabular-nums"
                  >
                    {HORA.format(new Date(registro.ocurridoEn))}
                  </time>
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-2.5 -left-3 flex size-6 items-center justify-center rounded-full border bg-background',
                      registro.accion === 'leer' && 'border-sky-300 text-sky-700 dark:text-sky-300',
                      registro.accion === 'eliminar' && 'border-destructive/40 text-destructive',
                    )}
                  >
                    <HugeiconsIcon icon={ICONOS[registro.accion]} size={14} />
                  </span>
                  <button
                    type="button"
                    aria-current={seleccionado === registro.id || undefined}
                    onClick={() => alElegir(registro)}
                    className="ml-5 flex min-h-11 w-[calc(100%-1.25rem)] flex-col items-start rounded-md px-3 py-2 text-left text-sm hover:bg-muted aria-[current=true]:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                  >
                    <span>
                      <span className="inline-flex items-center gap-1 font-medium">
                        {esSistema && <HugeiconsIcon icon={Robot01Icon} size={14} aria-hidden />}
                        {nombreDeActor(registro)}
                      </span>{' '}
                      {queHizo(registro)}
                    </span>
                    {registro.finalidad && (
                      <span className="text-xs text-muted-foreground">
                        Finalidad: {legible(registro.finalidad)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
