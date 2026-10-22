import type { ReactNode } from 'react';
import { useCola } from '@/offline/cola.ts';
import type { ComandoEnCola, TipoDeComando } from '@/offline/colaDb.ts';
import { useEstadoDeConexion } from '@/offline/useEstadoDeConexion.ts';
import { Button } from '@/ui/button';

const NOMBRE_DE_TIPO: Record<TipoDeComando, string> = {
  recepcion: 'Recepción',
};

const HORA = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Lo que este celular registró y la API aún no confirmó, y lo que rechazó.
 * Un rechazo no se borra: la coordinación lo concilia con la entrega física
 * (ADR-10, RF-M1-11).
 */
export function SincronizacionPage() {
  const { comandos, sincronizarAhora } = useCola();
  const conectado = useEstadoDeConexion();
  const enConflicto = comandos.filter((comando) => comando.estado === 'conflicto');
  const porSincronizar = comandos.filter(
    (comando) => comando.estado === 'pendiente' || comando.estado === 'enviado',
  );

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Sincronización</h1>
        <p className="text-muted-foreground">
          Registros de este celular que la API no ha confirmado.
        </p>
      </header>

      <section aria-labelledby="titulo-conflictos" className="flex flex-col gap-3">
        <h2 id="titulo-conflictos" className="text-lg font-semibold">
          En conflicto ({enConflicto.length})
        </h2>
        {enConflicto.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguno.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              La API los rechazó. Quedan aquí para que coordinación los concilie con lo que pasó en
              la bodega.
            </p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {enConflicto.map((comando) => (
                <Fila key={comando.comandoId} comando={comando}>
                  <p className="text-sm">{comando.rechazo?.mensaje}</p>
                </Fila>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="titulo-pendientes" className="flex flex-col gap-3">
        <h2 id="titulo-pendientes" className="text-lg font-semibold">
          Pendientes de sincronizar ({porSincronizar.length})
        </h2>
        {porSincronizar.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todo lo registrado llegó a la API.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {conectado
                ? 'Se envían solos. Si tarda, puedes enviarlos ya.'
                : 'Sin señal. Se envían solos cuando vuelva.'}
            </p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {porSincronizar.map((comando) => (
                <Fila key={comando.comandoId} comando={comando}>
                  <p className="text-sm text-muted-foreground">
                    {comando.estado === 'enviado'
                      ? 'Enviando…'
                      : comando.intentos > 0
                        ? `Pendiente de sincronizar · ${comando.intentos} ${
                            comando.intentos === 1 ? 'intento' : 'intentos'
                          }`
                        : 'Pendiente de sincronizar'}
                  </p>
                </Fila>
              ))}
            </ul>
            <Button className="self-start" onClick={sincronizarAhora}>
              Sincronizar ahora
            </Button>
          </>
        )}
      </section>
    </main>
  );
}

function Fila({ comando, children }: { comando: ComandoEnCola; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-1 p-3">
      <p className="flex justify-between gap-2 font-medium">
        <span>{NOMBRE_DE_TIPO[comando.tipo]}</span>
        <time className="text-sm font-normal text-muted-foreground" dateTime={comando.creadoEn}>
          {HORA.format(new Date(comando.creadoEn))}
        </time>
      </p>
      {children}
    </li>
  );
}
