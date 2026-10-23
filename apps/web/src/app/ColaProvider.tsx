import { useAuth0 } from '@auth0/auth0-react';
import { CABECERAS } from '@sigba/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ColaContext, type Cola } from '@/offline/cola.ts';
import { colaDb, RUTA_DE_COMANDO, type ComandoEnCola } from '@/offline/colaDb.ts';
import { crearSincronizador, type Sincronizador } from '@/offline/sincronizar.ts';
import { uuidv7 } from '@/offline/uuidv7.ts';
import { useAsignacion, usePedir } from '@/shared/sesion.ts';

const LIMITE_DE_ENVIO_MS = 20_000;

/**
 * La cola de comandos sin señal del banco activo (ADR-10). Sincroniza al
 * abrir la app, al encolar y al volver la red sin esperar el reintento
 * (RNF-M1-05); al abrir también borra los confirmados de más de 7 días. Volver a iniciar sesión recarga la app, así que la cola retoma al
 * abrir. El token sigue en memoria: la cola guarda comandos, nunca
 * credenciales (ADR-06).
 */
export function ColaProvider({ children }: { children: ReactNode }) {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const usuario = useAuth0().user?.sub ?? null;
  const pedir = usePedir();
  const [comandos, setComandos] = useState<ComandoEnCola[]>([]);
  const sincronizador = useRef<Sincronizador | null>(null);
  // `pedir` cambia con cada render de la sesión; la cola no se rearma por eso.
  const pedirActual = useRef(pedir);

  useEffect(() => {
    pedirActual.current = pedir;
  }, [pedir]);

  useEffect(() => {
    if (!bancoId || !usuario) return;
    const actual = crearSincronizador({
      bancoId,
      usuario,
      enviar: ({ tipo, carga, comandoId }) =>
        pedirActual.current(RUTA_DE_COMANDO[tipo], {
          method: 'POST',
          // El banco del comando, no el de la sesión de ese momento.
          headers: { [CABECERAS.banco]: bancoId },
          body: JSON.stringify({ ...carga, comandoId }),
          // Sin respuesta en ese tiempo, la señal se cayó: el comando vuelve a la cola.
          signal: AbortSignal.timeout(LIMITE_DE_ENVIO_MS),
        }),
    });
    sincronizador.current = actual;
    void actual.disparar();
    // Los confirmados viejos no hacen falta: la API los reconoce por su comandoId.
    void colaDb.purgarConfirmados().catch(() => undefined);

    const alVolverLaRed = () => void actual.disparar(true);
    window.addEventListener('online', alVolverLaRed);
    const dejarDeObservar = colaDb.observar(bancoId, usuario, setComandos);

    return () => {
      actual.detener();
      window.removeEventListener('online', alVolverLaRed);
      dejarDeObservar();
      setComandos([]);
    };
  }, [bancoId, usuario]);

  const encolar = useCallback<Cola['encolar']>(
    async (tipo, carga, comandoId = uuidv7()) => {
      if (!bancoId || !usuario) throw new Error('La sesión no tiene un banco activo.');
      const guardado = await colaDb.agregarSiNoExiste({
        comandoId,
        bancoId,
        usuario,
        tipo,
        carga,
        estado: 'pendiente',
        creadoEn: new Date().toISOString(),
        intentos: 0,
        proximoIntento: 0,
      });
      // Sin forzar: con la API caída, un comando nuevo no se salta la espera del reintento.
      void sincronizador.current?.disparar();
      return guardado;
    },
    [bancoId, usuario],
  );

  const valor = useMemo<Cola>(
    () => ({
      comandos,
      encolar,
      sincronizarAhora: () => void sincronizador.current?.disparar(true),
    }),
    [comandos, encolar],
  );

  return <ColaContext value={valor}>{children}</ColaContext>;
}
