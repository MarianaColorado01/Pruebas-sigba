import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { ACCIONES_DE_AUDITORIA, type TipoDeActor } from '@sigba/shared-types';
import type { ReactNode } from 'react';
import { type FiltrosDeAuditoria, legible, NOMBRES_DE_ACCION } from './auditoria.ts';

const QUIEN: [TipoDeActor | undefined, string][] = [
  [undefined, 'Todos'],
  ['usuario', 'Personas'],
  ['sistema', 'Sistema'],
];

function Segmentos<T extends string>({
  etiqueta,
  opciones,
  valor,
  alCambiar,
}: {
  etiqueta: string;
  opciones: [T | undefined, string][];
  valor: T | undefined;
  alCambiar: (valor: T | undefined) => void;
}) {
  return (
    <div
      role="group"
      aria-label={etiqueta}
      className="flex shrink-0 rounded-md border bg-muted/40 p-0.5"
    >
      {opciones.map(([opcion, nombre]) => (
        <button
          key={nombre}
          type="button"
          aria-pressed={valor === opcion}
          onClick={() => alCambiar(opcion)}
          className="h-10 rounded-[calc(var(--radius)*0.6)] px-3 text-sm whitespace-nowrap text-muted-foreground aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-xs"
        >
          {nombre}
        </button>
      ))}
    </div>
  );
}

function Chip({ children, alQuitar }: { children: ReactNode; alQuitar: () => void }) {
  return (
    <span className="inline-flex h-10 items-center gap-1 rounded-md border bg-muted/40 pr-1 pl-3 text-sm">
      {children}
      <button
        type="button"
        onClick={alQuitar}
        aria-label="Quitar filtro"
        className="flex size-8 items-center justify-center rounded-sm hover:bg-muted"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
      </button>
    </span>
  );
}

const CAMPO_FECHA =
  'h-10 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none';

/**
 * Filtros en una barra compacta que cabe en una línea en pantalla ancha y se
 * desliza de lado en el celular. Actor y entidad no tienen campo: se fijan
 * desde el detalle de un registro y aparecen aquí como chips.
 */
export function BarraDeFiltros({
  filtros,
  alCambiar,
  acciones,
}: {
  filtros: FiltrosDeAuditoria;
  alCambiar: (filtros: FiltrosDeAuditoria) => void;
  /** Lo que va al final de la barra, como exportar. */
  acciones?: ReactNode;
}) {
  const cambiar = (cambio: Partial<FiltrosDeAuditoria>) => alCambiar({ ...filtros, ...cambio });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="-mx-4 flex max-w-[100vw] gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        <Segmentos
          etiqueta="Acción"
          opciones={[
            [undefined, 'Todo'],
            ...ACCIONES_DE_AUDITORIA.map((a) => [a, NOMBRES_DE_ACCION[a]] as [typeof a, string]),
          ]}
          valor={filtros.accion}
          alCambiar={(accion) => cambiar({ accion })}
        />
        <Segmentos
          etiqueta="Quién"
          opciones={QUIEN}
          valor={filtros.tipoActor}
          alCambiar={(tipoActor) => cambiar({ tipoActor })}
        />
      </div>

      <div className="flex w-full items-center gap-2 sm:w-auto">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
          Desde
          <input
            type="date"
            value={filtros.desde ?? ''}
            max={filtros.hasta}
            onChange={(e) => cambiar({ desde: e.target.value || undefined })}
            className={CAMPO_FECHA}
          />
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-muted-foreground">
          Hasta
          <input
            type="date"
            value={filtros.hasta ?? ''}
            min={filtros.desde}
            onChange={(e) => cambiar({ hasta: e.target.value || undefined })}
            className={CAMPO_FECHA}
          />
        </label>
      </div>

      {filtros.actor && (
        <Chip alQuitar={() => cambiar({ actor: undefined })}>
          Actor <span className="font-mono text-xs">{filtros.actor.slice(0, 18)}</span>
        </Chip>
      )}
      {filtros.entidad && (
        <Chip alQuitar={() => cambiar({ entidad: undefined })}>{legible(filtros.entidad)}</Chip>
      )}

      {acciones && <div className="ml-auto">{acciones}</div>}
    </div>
  );
}
