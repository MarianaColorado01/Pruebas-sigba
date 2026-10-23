import { createContext, useContext } from 'react';
import type { ComandoEnCola, TipoDeComando } from './colaDb.ts';

export interface Cola {
  /** Los comandos de la persona en el banco activo, del más viejo al más nuevo. */
  comandos: ComandoEnCola[];
  /**
   * Guarda el comando en el celular y lo envía en cuanto pueda. La carga va
   * sin `comandoId`: la cola lo agrega al enviar. Quien llama puede pasar el
   * suyo para conservarlo entre reintentos; si no, la cola genera uno. Si ya
   * hay un comando de la persona con ese `comandoId`, no lo duplica y devuelve el
   * guardado; si es de otro banco u otra persona, lanza un error.
   */
  encolar(
    tipo: TipoDeComando,
    carga: Record<string, unknown>,
    comandoId?: string,
  ): Promise<ComandoEnCola>;
  /** Envía ya lo pendiente, sin esperar el próximo reintento. */
  sincronizarAhora(): void;
}

/** Lo llena `ColaProvider` (app/). Fuera de él la cola está vacía y no acepta comandos. */
export const ColaContext = createContext<Cola>({
  comandos: [],
  encolar: () => Promise.reject(new Error('La cola se usa dentro de ColaProvider.')),
  sincronizarAhora: () => undefined,
});

export function useCola(): Cola {
  return useContext(ColaContext);
}
