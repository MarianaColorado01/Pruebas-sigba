import { Copy01Icon, Mail01Icon, Share08Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useState } from 'react';
import type { InvitacionEmitida } from '@sigba/shared-types';
import { Button } from '@/ui/button';

const fecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long' });

/**
 * El enlace de una invitación recién creada o reenviada (D1). El enlace es el
 * canal principal: se copia o se comparte, y en el celular compartir abre
 * WhatsApp. El correo es un extra que puede no haber salido.
 *
 * Si ya había una invitación pendiente para ese correo no hay enlace que
 * mostrar: la API solo guarda el hash. Se pide reenviarla desde la lista.
 */
export function EnlaceListo({
  emitida,
  nombre,
  email,
}: {
  emitida: InvitacionEmitida;
  nombre: string;
  email: string;
}) {
  const [copiado, marcarCopiado] = useState(false);
  const puedeCompartir = typeof navigator.share === 'function';
  const { enlace } = emitida;

  if (enlace === null) {
    return (
      <div
        role="status"
        className="flex flex-col gap-2 rounded-lg border border-foreground/15 bg-muted/60 p-4 text-sm"
      >
        <p className="font-medium">Ya había una invitación pendiente para {email}</p>
        <p className="text-muted-foreground">
          No creamos otra ni mandamos otro correo. Para obtener un enlace, usa Reenviar en la lista;
          el anterior deja de servir. Vence el {fecha.format(new Date(emitida.venceEn))}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-foreground/15 bg-muted/60 p-4">
      <p className="text-sm font-medium">Enlace para {nombre}</p>
      <p className="truncate rounded-md bg-background px-3 py-2 font-mono text-xs" title={enlace}>
        {enlace}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(enlace);
            marcarCopiado(true);
          }}
        >
          <HugeiconsIcon icon={Copy01Icon} aria-hidden />
          {copiado ? 'Copiado' : 'Copiar enlace'}
        </Button>
        {puedeCompartir && (
          <Button
            onClick={() =>
              navigator
                .share({
                  title: 'Invitación a SIGBA',
                  text: `${nombre}, con este enlace entras a SIGBA:`,
                  url: enlace,
                })
                // Cerrar la hoja de compartir rechaza la promesa; no es un error.
                .catch(() => undefined)
            }
          >
            <HugeiconsIcon icon={Share08Icon} aria-hidden />
            Compartir
          </Button>
        )}
      </div>
      <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
        <HugeiconsIcon icon={Mail01Icon} size={18} className="mt-0.5" aria-hidden />
        {emitida.correoEnviado
          ? `También salió un correo a ${email}.`
          : 'No salió correo. Comparte el enlace por WhatsApp o como prefieras.'}
      </p>
      <p className="text-xs text-muted-foreground">
        Sirve una sola vez y vence el {fecha.format(new Date(emitida.venceEn))}.
      </p>
    </div>
  );
}
