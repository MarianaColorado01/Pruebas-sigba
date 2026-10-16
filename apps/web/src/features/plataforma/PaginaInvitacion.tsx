import { useAuth0 } from '@auth0/auth0-react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useParams } from 'react-router';
import type { InvitacionAceptada } from '@sigba/shared-types';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { usePedir } from '@/shared/sesion.ts';
import { Button } from '@/ui/button';
import { NOMBRE_DE_ROL } from './api.ts';

/**
 * El token de la invitación sobrevive a la ida y vuelta de Auth0 en
 * `sessionStorage`: muere al cerrar la pestaña y se borra apenas la API
 * responde. No es el token de Auth0, que sigue solo en memoria (ADR-06).
 */
export const CLAVE_DE_INVITACION = 'sigba:invitacion';

const VUELTA = { returnTo: '/invitacion' };

/**
 * `/invitacion/:token` guarda el token y salta a `/invitacion`, para que el
 * token no quede en el historial ni viaje a Auth0. Ahí la persona crea su
 * cuenta o inicia sesión (D2) y, al volver, se acepta la invitación.
 */
export function PaginaInvitacion() {
  const { token } = useParams();
  if (token) {
    sessionStorage.setItem(CLAVE_DE_INVITACION, token);
    return <Navigate to="/invitacion" replace />;
  }
  return <AceptarInvitacion />;
}

function AceptarInvitacion() {
  const { isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const token = sessionStorage.getItem(CLAVE_DE_INVITACION);

  if (isLoading) {
    return (
      <Marco>
        <p role="status">Cargando sesión</p>
      </Marco>
    );
  }

  if (!isAuthenticated) {
    if (!token) return <SinInvitacion />;
    return (
      <Marco>
        <h1 className="text-2xl font-semibold tracking-tight">Te invitaron a SIGBA</h1>
        <p className="text-muted-foreground">
          Crea tu cuenta con el correo al que llegó esta invitación, o entra con la cuenta que ya
          tienes con ese correo. Después te damos acceso al banco.
        </p>
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            onClick={() =>
              loginWithRedirect({
                appState: VUELTA,
                authorizationParams: { screen_hint: 'signup' },
              })
            }
          >
            Crear mi cuenta
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => loginWithRedirect({ appState: VUELTA })}
          >
            Ya tengo cuenta
          </Button>
        </div>
      </Marco>
    );
  }

  return <Aceptacion token={token} />;
}

function Aceptacion({ token }: { token: string | null }) {
  const pedir = usePedir();
  const enviada = useRef(false);
  const aceptar = useMutation({
    mutationFn: (valor: string) =>
      pedir<InvitacionAceptada>('/invitaciones/aceptar', {
        method: 'POST',
        body: JSON.stringify({ token: valor }),
      }),
    onSuccess: () => sessionStorage.removeItem(CLAVE_DE_INVITACION),
    onError: (error) => {
      // Sin respuesta de la API, o con un 401 o un 403, se conserva: con un 403
      // la persona puede entrar con la cuenta del correo invitado y reintentar.
      if (error instanceof ErrorDeApi && error.estado !== 401 && error.estado !== 403) {
        sessionStorage.removeItem(CLAVE_DE_INVITACION);
      }
    },
  });
  const { mutate } = aceptar;

  useEffect(() => {
    if (token && !enviada.current) {
      enviada.current = true;
      mutate(token);
    }
  }, [token, mutate]);

  if (!token && aceptar.isIdle) return <SinInvitacion />;

  if (aceptar.data) {
    return (
      <Marco>
        <h1 className="text-2xl font-semibold tracking-tight">Ya tienes acceso</h1>
        <p className="text-muted-foreground">
          Entras al banco como {NOMBRE_DE_ROL[aceptar.data.rol]}.
        </p>
        {/* Recarga para que la sesión lea la asignación nueva. */}
        <Button size="lg" onClick={() => window.location.assign('/')}>
          Entrar a SIGBA
        </Button>
      </Marco>
    );
  }

  if (aceptar.error) {
    const rechazo = aceptar.error instanceof ErrorDeApi && aceptar.error.codigo;
    return (
      <Marco>
        <h1 className="text-2xl font-semibold tracking-tight">
          {!rechazo
            ? 'No pudimos aceptar la invitación'
            : aceptar.error instanceof ErrorDeApi && aceptar.error.estado === 403
              ? 'No podemos darte acceso con esta cuenta'
              : 'Esta invitación no sirve'}
        </h1>
        <p role="alert">
          {rechazo
            ? aceptar.error.message
            : 'Revisa la señal y vuelve a intentar. El enlace sigue guardado.'}
        </p>
        {!rechazo && token && (
          <Button size="lg" onClick={() => mutate(token)}>
            Intentar de nuevo
          </Button>
        )}
      </Marco>
    );
  }

  return (
    <Marco>
      <p role="status">Aceptando la invitación</p>
    </Marco>
  );
}

function SinInvitacion() {
  return (
    <Marco>
      <h1 className="text-2xl font-semibold tracking-tight">No hay invitación abierta</h1>
      <p className="text-muted-foreground">
        Abre de nuevo el enlace que te enviaron. Si ya no lo tienes, pide a quien te invitó que lo
        reenvíe.
      </p>
    </Marco>
  );
}

function Marco({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      {children}
    </main>
  );
}
