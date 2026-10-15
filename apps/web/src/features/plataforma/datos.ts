import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BancoDto, BodegaDto } from '@sigba/shared-types';
import { ErrorDeApi } from '@/shared/clienteHttp';
import { useAsignacion, usePedir } from '@/shared/sesion';

/**
 * Bancos y bodegas contra la API (SBA-19). Se administran con señal: no pasan
 * por la cola offline, y la lista se vuelve a pedir después de cada cambio.
 */

const JSON_POST = (cuerpo?: object): RequestInit => ({
  method: 'POST',
  ...(cuerpo && { body: JSON.stringify(cuerpo) }),
});

const JSON_PATCH = (cuerpo: object): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(cuerpo),
});

export interface CambiosDeBodega {
  nombre?: string;
  direccion?: string | null;
}

/** Todas las bodegas del banco de la sesión, activas e inactivas. */
export function useBodegas() {
  const pedir = usePedir();
  const bancoId = useAsignacion()?.bancoId;
  const clave = ['plataforma', 'bodegas', bancoId];
  const cliente = useQueryClient();
  const refrescar = () => cliente.invalidateQueries({ queryKey: clave });

  const lista = useQuery({
    queryKey: clave,
    queryFn: () => pedir<BodegaDto[]>('/bodegas?incluirInactivas=true'),
    enabled: Boolean(bancoId),
  });

  const crear = useMutation({
    mutationFn: (nueva: { nombre: string }) => pedir<BodegaDto>('/bodegas', JSON_POST(nueva)),
    onSuccess: refrescar,
  });

  const editar = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: CambiosDeBodega }) =>
      pedir<BodegaDto>(`/bodegas/${id}`, JSON_PATCH(cambios)),
    onSuccess: refrescar,
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, activa }: { id: string; activa: boolean }) =>
      pedir<BodegaDto>(`/bodegas/${id}/${activa ? 'reactivar' : 'desactivar'}`, JSON_POST()),
    onSuccess: refrescar,
  });

  return { lista, crear, editar, cambiarEstado };
}

export interface CambiosDeBanco {
  nombre?: string;
  codigo?: string;
}

/** Los bancos de la red. Solo para `super_admin`. */
export function useBancos() {
  const pedir = usePedir();
  const clave = ['plataforma', 'bancos'];
  const cliente = useQueryClient();
  const refrescar = () => cliente.invalidateQueries({ queryKey: clave });

  const lista = useQuery({ queryKey: clave, queryFn: () => pedir<BancoDto[]>('/bancos') });

  const crear = useMutation({
    mutationFn: (nuevo: { nombre: string; codigo: string }) =>
      pedir<BancoDto>('/bancos', JSON_POST(nuevo)),
    onSuccess: refrescar,
  });

  const editar = useMutation({
    mutationFn: ({ id, cambios }: { id: string; cambios: CambiosDeBanco }) =>
      pedir<BancoDto>(`/bancos/${id}`, JSON_PATCH(cambios)),
    onSuccess: refrescar,
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ id, activo }: { id: string; activo: boolean }) =>
      pedir<BancoDto>(`/bancos/${id}/${activo ? 'reactivar' : 'desactivar'}`, JSON_POST()),
    onSuccess: refrescar,
  });

  return { lista, crear, editar, cambiarEstado };
}

/**
 * Lo que la persona puede hacer con el error. `repetido` es el texto del 409,
 * que cambia según qué se repite.
 */
export function mensajeDeError(error: unknown, repetido: string): string {
  if (!(error instanceof ErrorDeApi)) {
    return 'No se pudo guardar. Revisa la señal e inténtalo de nuevo.';
  }
  if (error.estado === 409) return repetido;
  if (error.estado === 403) return 'Tu rol no permite este cambio.';
  if (error.estado === 400) return 'Revisa los datos: algo no cumple el formato.';
  if (error.estado === 404) return 'Ya no existe. Vuelve a cargar la lista.';
  return 'No se pudo guardar. Inténtalo de nuevo en un momento.';
}
