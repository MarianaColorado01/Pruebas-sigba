import type { ReactNode } from 'react';
import type { Rol } from '@sigba/shared-types';
import { tieneRol, useAsignacion } from './sesion.ts';

/**
 * Muestra `children` solo a esos roles. Es comodidad, no seguridad: la API
 * rechaza igual con `@Roles()`, así que pon aquí los mismos roles que allá.
 *
 *   <SoloPara roles={['admin_banco', 'coordinacion']}>
 *     <Button>Aprobar precio</Button>
 *   </SoloPara>
 */
export function SoloPara({ roles, children }: { roles: readonly Rol[]; children: ReactNode }) {
  return tieneRol(useAsignacion(), roles) ? children : null;
}
