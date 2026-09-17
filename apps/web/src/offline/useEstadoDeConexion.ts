import { useEffect, useState } from 'react';

/**
 * Si el navegador cree tener red. `navigator.onLine` detecta el enlace, no si
 * la API responde: sirve para avisar al operario, no para decidir si un dato
 * está confirmado en el servidor (ADR-10).
 */
export function useEstadoDeConexion(): boolean {
  const [conectado, setConectado] = useState(() => navigator.onLine);

  useEffect(() => {
    const alConectar = () => setConectado(true);
    const alDesconectar = () => setConectado(false);

    window.addEventListener('online', alConectar);
    window.addEventListener('offline', alDesconectar);

    return () => {
      window.removeEventListener('online', alConectar);
      window.removeEventListener('offline', alDesconectar);
    };
  }, []);

  return conectado;
}
