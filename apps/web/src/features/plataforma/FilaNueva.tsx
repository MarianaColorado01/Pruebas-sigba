import { Add01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Button } from '@/ui/button';

/**
 * Última fila de la lista: se toca y se escribe ahí mismo, sin salir de la
 * lista ni abrir un formulario aparte. Después de guardar queda abierta para
 * la siguiente, como en Things; Escape o «Listo» la cierra.
 *
 * `campos` son los inputs, con `name`. `onGuardar` recibe el formulario y
 * devuelve si se guardó, para limpiar los campos solo entonces.
 */
export function FilaNueva({
  etiqueta,
  campos,
  error,
  guardando,
  onGuardar,
}: {
  etiqueta: string;
  campos: ReactNode;
  error: string | null;
  guardando: boolean;
  onGuardar: (datos: FormData) => Promise<boolean>;
}) {
  const [abierta, setAbierta] = useState(false);

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    if (await onGuardar(new FormData(formulario))) {
      formulario.reset();
      formulario.querySelector('input')?.focus();
    }
  }

  if (!abierta) {
    return (
      <button
        type="button"
        onClick={() => setAbierta(true)}
        className="flex min-h-14 w-full items-center gap-3 px-4 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
      >
        <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-current">
          <HugeiconsIcon icon={Add01Icon} size={16} aria-hidden />
        </span>
        {etiqueta}
      </button>
    );
  }

  return (
    <form
      onSubmit={enviar}
      onKeyDown={(evento) => evento.key === 'Escape' && setAbierta(false)}
      aria-label={etiqueta}
      className="flex flex-col gap-3 bg-muted/40 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row">{campos}</div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Agregar'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setAbierta(false)}>
          Listo
        </Button>
      </div>
    </form>
  );
}
