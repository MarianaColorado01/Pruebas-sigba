import { type ReactNode, useState } from 'react';
import type { InvitacionDelBanco, UsuarioDelBanco } from '@sigba/shared-types';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { Button } from '@/ui/button';
import {
  NOMBRE_DE_ROL,
  useInvitaciones,
  useQuitarAcceso,
  useReenviar,
  useRevocar,
  useUsuariosDelBanco,
} from './api.ts';
import { EnlaceListo } from './EnlaceListo.tsx';
import { FilaInvitar } from './FilaInvitar.tsx';

const fecha = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' });

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? '')
    .join('');
}

function Avatar({ nombre, pendiente = false }: { nombre: string; pendiente?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        pendiente ? 'border border-dashed border-foreground/30 text-muted-foreground' : 'bg-muted'
      }`}
    >
      {iniciales(nombre)}
    </span>
  );
}

/**
 * Quién entra al banco (SBA-19). Una sola lista: primero quien tiene acceso,
 * después las invitaciones abiertas y al final la fila para invitar. Cada fila
 * se abre en su sitio para actuar sobre ella, sin pantallas aparte.
 */
export function PantallaUsuarios() {
  const usuarios = useUsuariosDelBanco();
  const invitaciones = useInvitaciones();
  const error = usuarios.error ?? invitaciones.error;

  if (error) {
    return (
      <Marco>
        <p role="alert">
          {error instanceof ErrorDeApi && error.estado === 403
            ? 'Solo la administración del banco gestiona quién entra.'
            : 'No se pudo cargar la lista. Revisa la señal y vuelve a intentar.'}
        </p>
      </Marco>
    );
  }
  if (!usuarios.data || !invitaciones.data) {
    return (
      <Marco>
        <p role="status">Cargando personas</p>
      </Marco>
    );
  }

  const abiertas = invitaciones.data.filter((i) => i.estado !== 'aceptada');
  const aceptadas = invitaciones.data.filter((i) => i.estado === 'aceptada');

  return (
    <Marco
      resumen={`${usuarios.data.length} con acceso · ${abiertas.length} ${
        abiertas.length === 1 ? 'invitación abierta' : 'invitaciones abiertas'
      }`}
    >
      <ul className="flex flex-col gap-1" aria-label="Personas con acceso">
        {usuarios.data.map((usuario) => (
          <FilaUsuario key={`${usuario.usuarioId}-${usuario.rol}`} usuario={usuario} />
        ))}
      </ul>

      <h2 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Invitaciones
      </h2>
      <ul className="flex flex-col gap-1" aria-label="Invitaciones">
        {abiertas.map((invitacion) => (
          <FilaInvitacion key={invitacion.id} invitacion={invitacion} />
        ))}
        <FilaInvitar />
      </ul>

      {aceptadas.length > 0 && (
        <details className="mt-6">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-muted-foreground">
            {aceptadas.length} {aceptadas.length === 1 ? 'aceptada' : 'aceptadas'}
          </summary>
          <ul className="flex flex-col gap-2 pt-2 text-sm">
            {aceptadas.map((i) => (
              <li key={i.id} className="flex flex-col">
                <span>
                  {i.nombre} · {NOMBRE_DE_ROL[i.rol]}
                </span>
                <span className="text-muted-foreground">
                  {/* D3: si aceptó otra persona, aquí se nota. */}
                  Aceptó {i.aceptadaPorNombre ?? 'alguien que ya no tiene acceso'}
                  {i.aceptadaEn && ` el ${fecha.format(new Date(i.aceptadaEn))}`}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Marco>
  );
}

function Marco({ resumen, children }: { resumen?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col px-4 pt-4 pb-16">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Personas del banco
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Quién entra a SIGBA</h1>
      {resumen && <p className="mt-1 mb-4 text-sm text-muted-foreground">{resumen}</p>}
      {children}
    </main>
  );
}

function FilaUsuario({ usuario }: { usuario: UsuarioDelBanco }) {
  const [abierta, abrir] = useState(false);
  const quitar = useQuitarAcceso();

  return (
    <li className="rounded-lg data-[abierta=true]:bg-muted/50" data-abierta={abierta}>
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => abrir(!abierta)}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-left focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        <Avatar nombre={usuario.nombre} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{usuario.nombre}</span>
          <span className="truncate text-xs text-muted-foreground">{usuario.email}</span>
        </span>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs">
          {NOMBRE_DE_ROL[usuario.rol]}
        </span>
      </button>
      {abierta && (
        <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
          <p className="text-sm text-muted-foreground">
            Desde el {fecha.format(new Date(usuario.desde))}. Si le quitas el acceso, deja de entrar
            a este banco. Su cuenta para iniciar sesión sigue existiendo.
          </p>
          {quitar.error && (
            <p role="alert" className="text-sm text-destructive">
              {quitar.error.message}
            </p>
          )}
          <Button
            variant="destructive"
            className="self-start"
            disabled={quitar.isPending}
            onClick={() => quitar.mutate(usuario.usuarioId)}
          >
            Quitar acceso
          </Button>
        </div>
      )}
    </li>
  );
}

function FilaInvitacion({ invitacion }: { invitacion: InvitacionDelBanco }) {
  const reenviar = useReenviar();
  const revocar = useRevocar();
  const vencida = invitacion.estado === 'vencida';
  const error = reenviar.error ?? revocar.error;

  return (
    <li className="flex flex-col gap-2 rounded-lg px-3 py-2">
      <div className="flex min-h-10 items-center gap-3">
        <Avatar nombre={invitacion.nombre} pendiente />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{invitacion.nombre}</span>
          <span className="truncate text-xs text-muted-foreground">
            {NOMBRE_DE_ROL[invitacion.rol]} ·{' '}
            <span className={vencida ? 'font-medium text-amber-700 dark:text-amber-400' : ''}>
              {vencida
                ? `venció el ${fecha.format(new Date(invitacion.venceEn))}`
                : `vence el ${fecha.format(new Date(invitacion.venceEn))}`}
            </span>
          </span>
        </span>
      </div>
      {reenviar.data ? (
        <EnlaceListo emitida={reenviar.data} nombre={invitacion.nombre} email={invitacion.email} />
      ) : (
        <div className="flex flex-wrap gap-2 pl-12">
          <Button
            variant={vencida ? 'default' : 'outline'}
            disabled={reenviar.isPending}
            onClick={() => reenviar.mutate(invitacion.id)}
          >
            {vencida ? 'Enviar enlace nuevo' : 'Reenviar'}
          </Button>
          <Button
            variant="ghost"
            disabled={revocar.isPending}
            onClick={() => revocar.mutate(invitacion.id)}
          >
            Revocar
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="pl-12 text-sm text-destructive">
          {error.message}
        </p>
      )}
    </li>
  );
}
