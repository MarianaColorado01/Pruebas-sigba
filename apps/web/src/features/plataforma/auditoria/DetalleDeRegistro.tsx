import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import type { RegistroDeAuditoria } from '@sigba/shared-types';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { legible, nombreDeActor, queHizo } from './auditoria.ts';

const FECHA_COMPLETA = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'full',
  timeStyle: 'medium',
});

function Dato({ termino, children }: { termino: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{termino}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/**
 * Detalle de un registro. En pantalla ancha es un panel al lado de la línea
 * de tiempo; en el celular, una hoja que sube desde abajo.
 */
export function DetalleDeRegistro({
  registro,
  alCerrar,
  alFiltrarActor,
  alFiltrarEntidad,
}: {
  registro: RegistroDeAuditoria;
  alCerrar: () => void;
  alFiltrarActor: (actor: string) => void;
  alFiltrarEntidad: (entidad: string) => void;
}) {
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') alCerrar();
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [alCerrar]);

  const actor = registro.actorId ?? registro.actorEtiqueta;
  const { cantidad, camposModificados, version } = registro.detalle ?? {};

  return (
    <>
      <button
        type="button"
        aria-label="Cerrar detalle"
        onClick={alCerrar}
        className="fixed inset-0 z-20 bg-foreground/20 md:hidden"
      />
      <aside
        aria-label="Detalle del registro"
        className="fixed inset-x-0 bottom-0 z-30 max-h-[80dvh] overflow-y-auto rounded-t-xl border-t bg-background p-5 shadow-lg md:sticky md:top-4 md:z-auto md:max-h-[calc(100dvh-2rem)] md:w-96 md:shrink-0 md:self-start md:rounded-xl md:border md:shadow-none"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="font-medium">
            {nombreDeActor(registro)} {queHizo(registro)}
          </p>
          <Button variant="ghost" size="icon-sm" aria-label="Cerrar detalle" onClick={alCerrar}>
            <HugeiconsIcon icon={Cancel01Icon} />
          </Button>
        </div>

        <dl className="flex flex-col gap-3">
          <Dato termino="Cuándo">{FECHA_COMPLETA.format(new Date(registro.ocurridoEn))}</Dato>
          <Dato termino="Quién">
            {registro.tipoActor === 'sistema' ? 'Tarea del sistema' : 'Persona'}
            {actor && (
              <span className="block font-mono text-xs text-muted-foreground">{actor}</span>
            )}
          </Dato>
          <Dato termino="Entidad">{legible(registro.entidad)}</Dato>
          <Dato termino={registro.accion === 'leer' ? 'Conjunto consultado' : 'Registro'}>
            <span className="font-mono text-xs">{registro.entidadId}</span>
          </Dato>
          {registro.finalidad && <Dato termino="Finalidad">{legible(registro.finalidad)}</Dato>}
          {cantidad !== undefined && <Dato termino="Filas">{cantidad}</Dato>}
          {camposModificados && (
            <Dato termino="Campos modificados">{camposModificados.map(legible).join(', ')}</Dato>
          )}
          {version !== undefined && <Dato termino="Versión">{version}</Dato>}
          <Dato termino="Resultado">{registro.resultado}</Dato>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          {actor && (
            <Button variant="outline" size="sm" onClick={() => alFiltrarActor(actor)}>
              Solo este actor
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => alFiltrarEntidad(registro.entidad)}>
            Solo {legible(registro.entidad)}
          </Button>
        </div>
      </aside>
    </>
  );
}
