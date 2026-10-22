import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAsignacion, usePedir } from '@/shared/sesion.ts';

export const TIPOS_DE_DONANTE = ['empresa', 'parroquia', 'particular', 'otro_banco'] as const;
export type TipoDonante = (typeof TIPOS_DE_DONANTE)[number];

/** Lo que responde `GET /donantes` y `POST /donantes` (SBA-79). */
export interface Donante {
  id: string;
  nombre: string;
  tipo: TipoDonante;
  contacto: string | null;
  activo: boolean;
}

const CLAVE_DONANTES = ['inventario', 'donantes'] as const;

/** Búsqueda incremental: la API devuelve hasta 20, activos, por nombre. */
export function useDonantes(texto: string) {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const pedir = usePedir();
  const limpio = texto.trim();
  return useQuery({
    queryKey: [...CLAVE_DONANTES, bancoId, limpio],
    enabled: Boolean(bancoId && limpio),
    queryFn: () => pedir<Donante[]>(`/donantes?texto=${encodeURIComponent(limpio)}`),
  });
}

/** Alta rápida con nombre y tipo. Si ya existe, la API devuelve ese mismo. */
export function useCrearDonante() {
  const pedir = usePedir();
  const consultas = useQueryClient();
  return useMutation({
    mutationFn: (nuevo: { nombre: string; tipo: TipoDonante }) =>
      pedir<Donante>('/donantes', { method: 'POST', body: JSON.stringify(nuevo) }),
    onSuccess: () => consultas.invalidateQueries({ queryKey: CLAVE_DONANTES }),
  });
}
