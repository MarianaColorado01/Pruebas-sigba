import { Auth0Provider } from '@auth0/auth0-react';
import type { ReactNode } from 'react';

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
      // REQUISITO ESTRICTO DEL ADR-06: Tokens en memoria, no en localStorage
      cacheLocation="memory" 
    >
      {children}
    </Auth0Provider>
  );
};