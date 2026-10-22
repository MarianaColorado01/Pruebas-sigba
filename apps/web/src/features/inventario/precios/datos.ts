import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAsignacion, usePedir } from '@/shared/sesion.ts';

export const FUENTES = ['remision', 'sipsa', 'catalogo', 'manual'] as const;
export type Fuente = (typeof FUENTES)[number];

/** Un precio del maestro (SBA-39), con el estado del día: vencido lo calcula la API. */
export interface Precio {
  id: string;
  referenciaId: string;
  /** Pesos con punto decimal. */
  valor: string;
  piso: string;
  techo: string;
  fuente: Fuente;
  evidencia: string;
  /** AAAA-MM-DD. */
  vigenteDesde: string;
  vigenteHasta: string | null;
  estado: 'propuesto' | 'aprobado' | 'vencido';
  motivoFueraDeBanda: string | null;
  aprobadoPor: string | null;
  aprobadoEn: string | null;
  creadoPor: string;
  creadoEn: string;
}

export interface PrecioVigente {
  referenciaId: string;
  fecha: string;
  valoracion: 'pendiente' | 'con_precio';
  precio: Precio | null;
}

export interface PropuestaDePrecio {
  comandoId: string;
  referenciaId: string;
  valor: string;
  piso: string;
  techo: string;
  fuente: Fuente;
  evidencia: string;
  vigenteDesde: string;
  vigenteHasta: string | null;
}

export interface AprobacionDePrecio {
  comandoId: string;
  precioId: string;
  motivoFueraDeBanda: string | null;
}

const clave = (bancoId: string | null, referenciaId: string | null) =>
  ['inventario', 'precios', bancoId, referenciaId] as const;

/** Historial completo y precio vigente de hoy de una referencia. */
export function usePreciosDeReferencia(referenciaId: string | null) {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const pedir = usePedir();
  const activa = Boolean(bancoId && referenciaId);
  const historial = useQuery({
    queryKey: [...clave(bancoId, referenciaId), 'historial'],
    enabled: activa,
    queryFn: () => pedir<Precio[]>(`/referencias/${referenciaId}/precios`),
  });
  const vigente = useQuery({
    queryKey: [...clave(bancoId, referenciaId), 'vigente'],
    enabled: activa,
    queryFn: () => pedir<PrecioVigente>(`/referencias/${referenciaId}/precio-vigente`),
  });
  return { historial, vigente };
}

/**
 * Proponer y aprobar llevan `comandoId`: quien llama lo conserva entre
 * reintentos para que la API no registre dos veces lo mismo.
 */
export function useEscribirPrecio() {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const pedir = usePedir();
  const consultas = useQueryClient();
  const refrescar = (referenciaId: string) =>
    consultas.invalidateQueries({ queryKey: clave(bancoId, referenciaId) });

  const proponer = useMutation({
    mutationFn: (propuesta: PropuestaDePrecio) =>
      pedir<Precio>('/precios', { method: 'POST', body: JSON.stringify(propuesta) }),
    onSuccess: (precio) => refrescar(precio.referenciaId),
  });
  const aprobar = useMutation({
    mutationFn: ({ precioId, ...cuerpo }: AprobacionDePrecio) =>
      pedir<Precio>(`/precios/${precioId}/aprobar`, {
        method: 'POST',
        body: JSON.stringify(cuerpo),
      }),
    onSuccess: (precio) => refrescar(precio.referenciaId),
  });
  return { proponer, aprobar };
}
