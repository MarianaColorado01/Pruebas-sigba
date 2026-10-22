import { useQuery } from '@tanstack/react-query';
import type { BodegaDto } from '@sigba/shared-types';
import { useAsignacion, usePedir } from '@/shared/sesion.ts';

/** Solo las activas: una bodega inactiva no recibe movimientos nuevos. */
export function useBodegasActivas() {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const pedir = usePedir();
  return useQuery({
    queryKey: ['inventario', 'bodegas', bancoId],
    enabled: Boolean(bancoId),
    queryFn: () => pedir<BodegaDto[]>('/bodegas'),
    select: (bodegas) => bodegas.filter((bodega) => bodega.activa),
  });
}
