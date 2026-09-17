import { useEstadoDeConexion } from '../offline/useEstadoDeConexion.ts';

export function Inicio() {
  const conectado = useEstadoDeConexion();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">SIGBA</h1>
      <p className="text-slate-600">Sistema Integrado de Gestión para Bancos de Alimentos.</p>
      <p
        className={
          conectado ? 'text-sm font-medium text-emerald-700' : 'text-sm font-medium text-amber-700'
        }
      >
        {conectado ? 'Con señal' : 'Sin señal · lo registrado se sincroniza al volver'}
      </p>
    </main>
  );
}
