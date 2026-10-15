import { type Query, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AsignacionDeUsuario } from '@sigba/shared-types';
import { useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { SesionContext, usePedir } from '@/shared/sesion.ts';
import {
  bancoRecordado,
  claveDe,
  opcionesDe,
  opcionInicial,
  recordarBanco,
} from './eleccionDeBanco.ts';
import { CerrarSesion, PantallaDeAcceso, SelectorDeBanco, SinAcceso } from './SelectorDeBanco.tsx';
import { BancoActivoContext, useCerrarSesion } from './sesionActiva.ts';

/** Las consultas que dependen de la persona y no del banco: sobreviven al cambio de banco. */
const PREFIJO_PERSONAL = 'yo';
const CLAVE_ASIGNACIONES = [PREFIJO_PERSONAL, 'asignaciones'] as const;
const delBanco = { predicate: (q: Query) => q.queryKey[0] !== PREFIJO_PERSONAL };

/**
 * Carga las asignaciones de la persona y decide con qué banco trabaja (D13).
 * Con una la usa; con varias pregunta, salvo que recuerde el último banco;
 * sin ninguna explica que hace falta una invitación. Hasta tener banco no
 * muestra `children`: así ninguna pantalla pide datos sin `x-banco-id`.
 *
 * Cambiar de banco pasa siempre por el selector, que desmonta las pantallas:
 * ningún estado local cruza de un banco a otro, y `elegir` borra la caché.
 */
export function SesionProvider({ children }: { children: ReactNode }) {
  const pedir = usePedir();
  const clienteDeConsultas = useQueryClient();
  const cerrarSesion = useCerrarSesion();
  const [recordado] = useState(bancoRecordado);
  const [eleccion, setEleccion] = useState<{ clave?: string; eligiendo: boolean }>({
    eligiendo: false,
  });

  const consulta = useQuery({
    queryKey: CLAVE_ASIGNACIONES,
    queryFn: () => pedir<AsignacionDeUsuario[]>('/yo/asignaciones'),
  });

  if (consulta.isPending) return <PantallaDeAcceso titulo="Cargando tus bancos" ocupada />;

  if (consulta.isError) {
    return (
      <PantallaDeAcceso titulo="No pudimos cargar tus bancos">
        <p className="text-muted-foreground">Revisa la señal e inténtalo de nuevo.</p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => void consulta.refetch()}>Reintentar</Button>
          <CerrarSesion alPulsar={cerrarSesion} />
        </div>
      </PantallaDeAcceso>
    );
  }

  const opciones = opcionesDe(consulta.data);
  if (opciones.length === 0) return <SinAcceso alCerrarSesion={cerrarSesion} />;

  // Una elección que ya no está (le quitaron esa asignación) vuelve al selector
  // en vez de saltar sola a otro banco sin pasar por `elegir`.
  const actual =
    eleccion.clave === undefined
      ? opcionInicial(opciones, recordado)
      : (opciones.find((opcion) => claveDe(opcion) === eleccion.clave) ?? null);

  const elegir = (opcion: AsignacionDeUsuario) => {
    if (actual && claveDe(actual) !== claveDe(opcion)) {
      // Lo que hay en caché lo pidió la asignación anterior: no puede asomarse en la nueva.
      clienteDeConsultas.removeQueries(delBanco);
    }
    recordarBanco(opcion.bancoId);
    setEleccion({ clave: claveDe(opcion), eligiendo: false });
  };

  if (!actual || eleccion.eligiendo) {
    return (
      <SelectorDeBanco
        opciones={opciones}
        actual={actual}
        alElegir={elegir}
        alVolver={actual ? () => setEleccion({ ...eleccion, eligiendo: false }) : undefined}
        alCerrarSesion={cerrarSesion}
      />
    );
  }

  return (
    <SesionContext value={actual}>
      <BancoActivoContext
        value={{
          activa: actual,
          opciones,
          cambiar: () => setEleccion({ clave: claveDe(actual), eligiendo: true }),
        }}
      >
        {children}
      </BancoActivoContext>
    </SesionContext>
  );
}
