import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DiaDeRecogida,
  InstitucionDto,
  TipoDeInstitucion,
  TipoDePoblacionDto,
} from '@sigba/shared-types';
import { ErrorDeApi } from '@/shared/clienteHttp';
import { useAsignacion, usePedir } from '@/shared/sesion';

/**
 * Directorio de instituciones contra la API (SBA-26, SBA-86). Se administra con
 * señal, como bancos y bodegas: no pasa por la cola offline y la lista se
 * vuelve a pedir después de cada cambio.
 */

export const NOMBRE_DE_TIPO: Record<TipoDeInstitucion, string> = {
  parroquia: 'Parroquia',
  comunidad_religiosa: 'Comunidad religiosa',
  fundacion: 'Fundación',
};

export const NOMBRE_DE_DIA: Record<DiaDeRecogida, string> = {
  lunes: 'Lunes',
  martes: 'Martes',
  miercoles: 'Miércoles',
  jueves: 'Jueves',
  viernes: 'Viernes',
  sabado: 'Sábado',
  domingo: 'Domingo',
};

/** Lo que manda el formulario, igual para crear que para editar. */
export interface DatosDeInstitucion {
  nombre: string;
  tipo: TipoDeInstitucion;
  contactoNombre: string;
  contactoTelefono: string | null;
  contactoCorreo: string | null;
  direccion: string | null;
  diaRecogida: DiaDeRecogida | null;
  tipoPoblacionId: string;
}

/** Todas las instituciones del banco de la sesión, activas e inactivas. */
export function useInstituciones() {
  const pedir = usePedir();
  const bancoId = useAsignacion()?.bancoId;
  const clave = ['beneficiarios', 'instituciones', bancoId];
  const cliente = useQueryClient();
  const refrescar = () => cliente.invalidateQueries({ queryKey: clave });

  const lista = useQuery({
    queryKey: clave,
    queryFn: () => pedir<InstitucionDto[]>('/instituciones?incluirInactivas=true'),
    enabled: Boolean(bancoId),
  });

  const crear = useMutation({
    mutationFn: (datos: DatosDeInstitucion) =>
      pedir<InstitucionDto>('/instituciones', { method: 'POST', body: JSON.stringify(datos) }),
    onSuccess: refrescar,
  });

  const editar = useMutation({
    mutationFn: ({ id, datos }: { id: string; datos: DatosDeInstitucion }) =>
      pedir<InstitucionDto>(`/instituciones/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(datos),
      }),
    onSuccess: refrescar,
  });

  const desactivar = useMutation({
    mutationFn: (id: string) =>
      pedir<InstitucionDto>(`/instituciones/${id}/desactivar`, { method: 'POST' }),
    onSuccess: refrescar,
  });

  return { lista, crear, editar, desactivar };
}

/** El catálogo del banco, con los inactivos para poder nombrar el de una institución vieja. */
export function useTiposDePoblacion() {
  const pedir = usePedir();
  const bancoId = useAsignacion()?.bancoId;
  return useQuery({
    queryKey: ['beneficiarios', 'tipos-de-poblacion', bancoId],
    queryFn: () => pedir<TipoDePoblacionDto[]>('/tipos-de-poblacion'),
    enabled: Boolean(bancoId),
  });
}

/** Sin tildes ni mayúsculas, para que «maria» encuentre «María». */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Lo que la persona puede hacer con el error. Con 400 el servicio dice qué
 * campo falla, en español; se muestra tal cual. Si el 400 viene de la
 * validación de tipos, que no manda un texto, queda el genérico.
 */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ErrorDeApi)) {
    return 'No se pudo guardar. Revisa la señal e inténtalo de nuevo.';
  }
  if (error.estado === 409) return 'Ya hay una institución con ese nombre en este banco.';
  if (error.estado === 403) return 'Tu rol no permite este cambio.';
  if (error.estado === 404) return 'Esa institución ya no existe. Vuelve a cargar la lista.';
  if (error.estado === 400) {
    return error.message.startsWith('La API respondió')
      ? 'Revisa los datos: algo no cumple el formato.'
      : error.message;
  }
  return 'No se pudo guardar. Inténtalo de nuevo en un momento.';
}
