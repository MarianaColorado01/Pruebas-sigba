import { createContext, useContext } from 'react';

export interface EstadoReautenticacion {
  requerido: boolean;
  marcarRequerido(requerido: boolean): void;
}

export const ReautenticacionContext = createContext<EstadoReautenticacion>({
  requerido: false,
  marcarRequerido: () => undefined,
});

export function useEstadoReautenticacion(): EstadoReautenticacion {
  return useContext(ReautenticacionContext);
}
