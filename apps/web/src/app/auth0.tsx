import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { ReautenticacionContext, useEstadoReautenticacion } from '@/shared/reautenticacion.ts';
import { enrutador } from './enrutador.tsx';

/**
 * La página de invitación pide la sesión ella misma: ofrece crear cuenta o
 * entrar (D2). Con la pantalla de inicio de sesión de siempre, quien no tiene
 * cuenta no sabría que debe registrarse.
 */
const esInvitacion = () => window.location.pathname.startsWith('/invitacion');

export function ProviderAuth0({ children }: { children: ReactNode }) {
  const [requerido, marcarRequerido] = useState(false);
  const { VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID, VITE_AUTH0_AUDIENCE } = import.meta.env;
  if (!VITE_AUTH0_DOMAIN || !VITE_AUTH0_CLIENT_ID || !VITE_AUTH0_AUDIENCE) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">SIGBA</h1>
        <p role="alert">
          Falta configurar Auth0. Llena VITE_AUTH0_DOMAIN, VITE_AUTH0_CLIENT_ID y
          VITE_AUTH0_AUDIENCE en .env, según docs/arquitectura/auth0-setup.md, y reinicia la PWA.
        </p>
      </main>
    );
  }

  return (
    <Auth0Provider
      domain={VITE_AUTH0_DOMAIN}
      clientId={VITE_AUTH0_CLIENT_ID}
      cacheLocation="memory"
      useRefreshTokens
      // El enrutador ya arrancó en la URL de vuelta de Auth0: hay que llevarlo a
      // donde iba la persona, que es la página de invitación o la raíz.
      onRedirectCallback={(appState) =>
        void enrutador.navigate(appState?.returnTo ?? '/', { replace: true })
      }
      authorizationParams={{
        audience: VITE_AUTH0_AUDIENCE,
        redirect_uri: window.location.origin,
        scope: 'openid offline_access',
      }}
    >
      <ReautenticacionContext value={{ requerido, marcarRequerido }}>
        {children}
      </ReautenticacionContext>
    </Auth0Provider>
  );
}

export function AccesoAuth0({ children }: { children: ReactNode }) {
  const { error, isAuthenticated, isLoading, loginWithRedirect } = useAuth0();
  const { requerido } = useEstadoReautenticacion();

  if (isLoading)
    return (
      <main className="p-6" role="status">
        Cargando sesión
      </main>
    );

  if (!isAuthenticated && esInvitacion()) return children;

  if (error || !isAuthenticated) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">SIGBA</h1>
        <p role="status">
          {requerido
            ? 'La sesión venció. Inicia sesión para sincronizar los registros pendientes.'
            : error
              ? 'No fue posible iniciar sesión.'
              : 'Inicia sesión para continuar.'}
        </p>
        <Button onClick={() => loginWithRedirect()}>Iniciar sesión</Button>
      </main>
    );
  }

  return (
    <>
      {requerido && (
        <div className="flex items-center justify-between gap-3 border-b p-3" role="status">
          <span>Se requiere iniciar sesión para sincronizar los registros pendientes.</span>
          <Button onClick={() => loginWithRedirect()}>Iniciar sesión</Button>
        </div>
      )}
      {children}
    </>
  );
}
