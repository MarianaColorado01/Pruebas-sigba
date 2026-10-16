import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  InvitacionDelBanco,
  InvitacionEmitida,
  Rol,
  RolInvitablePorAdmin,
  UsuarioDelBanco,
} from '@sigba/shared-types';
import { usePedir } from '@/shared/sesion.ts';

/** Los nombres del catálogo `plataforma.rol` (Arquitectura 8.2). */
export const NOMBRE_DE_ROL: Record<Rol, string> = {
  super_admin: 'Administración de la red',
  admin_banco: 'Administración del banco',
  coordinacion: 'Coordinación',
  operario_bodega: 'Operario de bodega',
  voluntario: 'Voluntario',
  consulta: 'Consulta',
  institucion: 'Institución',
};

const CLAVES = {
  usuarios: ['plataforma', 'usuarios'],
  invitaciones: ['plataforma', 'invitaciones'],
} as const;

export function useUsuariosDelBanco() {
  const pedir = usePedir();
  return useQuery({
    queryKey: CLAVES.usuarios,
    queryFn: () => pedir<UsuarioDelBanco[]>('/usuarios'),
  });
}

export function useInvitaciones() {
  const pedir = usePedir();
  return useQuery({
    queryKey: CLAVES.invitaciones,
    queryFn: () => pedir<InvitacionDelBanco[]>('/invitaciones'),
  });
}

/** Una escritura que, al volver, refresca las dos listas de la pantalla. */
function useEscritura<E, R = unknown>(
  ruta: (entrada: E) => string,
  cuerpo?: (entrada: E) => unknown,
) {
  const pedir = usePedir();
  const consultas = useQueryClient();
  return useMutation({
    mutationFn: (entrada: E) =>
      pedir<R>(ruta(entrada), {
        method: 'POST',
        ...(cuerpo && { body: JSON.stringify(cuerpo(entrada)) }),
      }),
    onSettled: () =>
      Promise.all([
        consultas.invalidateQueries({ queryKey: CLAVES.usuarios }),
        consultas.invalidateQueries({ queryKey: CLAVES.invitaciones }),
      ]),
  });
}

export interface NuevaInvitacion {
  nombre: string;
  email: string;
  rol: RolInvitablePorAdmin;
}

export const useInvitar = () =>
  useEscritura<NuevaInvitacion, InvitacionEmitida>(
    () => '/invitaciones',
    (nueva) => nueva,
  );

export const useReenviar = () =>
  useEscritura<string, InvitacionEmitida>((id) => `/invitaciones/${id}/reenviar`);

export const useRevocar = () => useEscritura<string>((id) => `/invitaciones/${id}/revocar`);

export const useQuitarAcceso = () =>
  useEscritura<string>((usuarioId) => `/usuarios/${usuarioId}/asignacion/desactivar`);
