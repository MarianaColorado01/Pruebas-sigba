import { type ReactNode, useSyncExternalStore } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet';

const PANTALLA_ANCHA = '(min-width: 640px)';

function suscribir(avisar: () => void) {
  const consulta = window.matchMedia?.(PANTALLA_ANCHA);
  consulta?.addEventListener('change', avisar);
  return () => consulta?.removeEventListener('change', avisar);
}

/** Sin `matchMedia` (jsdom) se trata como celular, que es el caso que importa. */
const esAncha = () => window.matchMedia?.(PANTALLA_ANCHA).matches ?? false;

/**
 * Edición fuera de la lista: hoja inferior en el celular, que se alcanza con el
 * pulgar, y panel lateral en pantalla ancha, que deja ver la lista detrás.
 */
export function HojaDeEdicion({
  abierta,
  onCerrar,
  titulo,
  descripcion,
  children,
}: {
  abierta: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion: string;
  children: ReactNode;
}) {
  const ancha = useSyncExternalStore(suscribir, esAncha, () => false);

  return (
    <Sheet open={abierta} onOpenChange={(abrir) => !abrir && onCerrar()}>
      <SheetContent side={ancha ? 'right' : 'bottom'} className="overflow-y-auto">
        <SheetHeader className="pr-16">
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>{descripcion}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-6 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
