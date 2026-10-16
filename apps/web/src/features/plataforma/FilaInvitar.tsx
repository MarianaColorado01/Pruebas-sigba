import { Add01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useId, useState } from 'react';
import { ROLES_INVITABLES_POR_ADMIN, type RolInvitablePorAdmin } from '@sigba/shared-types';
import { Button } from '@/ui/button';
import { NOMBRE_DE_ROL, useInvitar } from './api.ts';
import { EnlaceListo } from './EnlaceListo.tsx';

const campo =
  'h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/**
 * La última fila de la lista: invitar sin salir de ella. Cerrada es un «+»;
 * abierta es el formulario en el mismo lugar, y al crear muestra el enlace.
 */
export function FilaInvitar() {
  const [abierta, abrir] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<RolInvitablePorAdmin>('operario_bodega');
  const invitar = useInvitar();
  const id = useId();

  const reiniciar = (siguienteAbierta: boolean) => {
    invitar.reset();
    setNombre('');
    setEmail('');
    abrir(siguienteAbierta);
  };

  if (!abierta) {
    return (
      <li>
        <button
          type="button"
          onClick={() => abrir(true)}
          className="flex min-h-14 w-full items-center gap-3 rounded-lg border border-dashed border-foreground/20 px-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-current">
            <HugeiconsIcon icon={Add01Icon} size={18} aria-hidden />
          </span>
          Invitar a alguien
        </button>
      </li>
    );
  }

  if (invitar.data) {
    return (
      <li className="flex flex-col gap-2">
        <EnlaceListo emitida={invitar.data} nombre={nombre} email={email} />
        <Button variant="ghost" className="self-start" onClick={() => reiniciar(true)}>
          Invitar a otra persona
        </Button>
      </li>
    );
  }

  return (
    <li>
      <form
        aria-label="Invitar a alguien"
        className="flex flex-col gap-4 rounded-lg border border-foreground/15 p-4"
        onSubmit={(evento) => {
          evento.preventDefault();
          invitar.mutate({ nombre, email, rol });
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${id}-nombre`}>
          Nombre
          <input
            id={`${id}-nombre`}
            className={campo}
            required
            maxLength={200}
            autoComplete="off"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor={`${id}-email`}>
          Correo
          <input
            id={`${id}-email`}
            className={campo}
            type="email"
            inputMode="email"
            required
            maxLength={200}
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Rol en el banco</legend>
          <div className="flex flex-wrap gap-2">
            {ROLES_INVITABLES_POR_ADMIN.map((opcion) => (
              <label
                key={opcion}
                className="flex min-h-11 cursor-pointer items-center rounded-full border border-input px-4 text-sm has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:ring-2 has-focus-visible:ring-ring/30"
              >
                <input
                  type="radio"
                  name={`${id}-rol`}
                  value={opcion}
                  checked={rol === opcion}
                  onChange={() => setRol(opcion)}
                  className="sr-only"
                />
                {NOMBRE_DE_ROL[opcion]}
              </label>
            ))}
          </div>
        </fieldset>
        {invitar.error && (
          <p role="alert" className="text-sm text-destructive">
            {invitar.error.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={invitar.isPending}>
            {invitar.isPending ? 'Creando enlace' : 'Crear invitación'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => reiniciar(false)}>
            Cancelar
          </Button>
        </div>
      </form>
    </li>
  );
}
