import { useAuth0 } from '@auth0/auth0-react';
import type { AsignacionDeUsuario } from '@sigba/shared-types';
import { createContext, useCallback, useContext } from 'react';
import { useEstadoReautenticacion } from '@/shared/reautenticacion.ts';

export interface BancoActivo {
  activa: AsignacionDeUsuario;
  opciones: readonly AsignacionDeUsuario[];
  /** Vuelve al selector. Solo tiene sentido con más de una opción. */
  cambiar(): void;
}

export const BancoActivoContext = createContext<BancoActivo | null>(null);

/** El banco con que trabaja la sesión. Solo existe dentro de `SesionProvider`. */
export function useBancoActivo(): BancoActivo {
  const banco = useContext(BancoActivoContext);
  if (!banco) throw new Error('useBancoActivo se usa dentro de SesionProvider.');
  return banco;
}

/** Cierra la sesión de Auth0 y olvida el aviso de reautenticación pendiente. */
export function useCerrarSesion() {
  const { logout } = useAuth0();
  const { marcarRequerido } = useEstadoReautenticacion();

  return useCallback(() => {
    marcarRequerido(false);
    void logout({ logoutParams: { returnTo: window.location.origin } });
  }, [logout, marcarRequerido]);
}
