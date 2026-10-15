import { BubbleChatIcon, WifiDisconnected01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/ui/button';
import { useEstadoDeConexion } from '../offline/useEstadoDeConexion.ts';

export function Inicio() {
  const conectado = useEstadoDeConexion();

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-6 md:py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">SIGBA</h1>
        <p className="text-muted-foreground">
          Sistema Integrado de Gestión para Bancos de Alimentos.
        </p>
      </div>

      {/*
        `role="status"` anuncia el cambio a quien usa lector de pantalla. El
        párrafo se renderiza siempre, también con señal: una región viva que
        aparece a la vez que su texto no se anuncia.
      */}
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        {conectado ? (
          'Con señal'
        ) : (
          <>
            <HugeiconsIcon icon={WifiDisconnected01Icon} size={18} aria-hidden />
            Sin señal · lo registrado se sincroniza al volver
          </>
        )}
      </p>

      <Button className="self-start">
        <HugeiconsIcon icon={BubbleChatIcon} aria-hidden />
        Registrar recepción
      </Button>

      <Link
        to="/catalogo"
        className={buttonVariants({ variant: 'outline', className: 'self-start' })}
      >
        Buscar en el catálogo
      </Link>

      <Link to="/stock" className={buttonVariants({ variant: 'outline', className: 'self-start' })}>
        Consultar stock
      </Link>
    </section>
  );
}
