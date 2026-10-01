import { ROLES, type Rol } from '@sigba/shared-types';

/** Una fila de `usuario_rol`, ya resuelta al código del rol. */
export interface Asignacion {
  rol: Rol;
  bancoId: string | null;
  institucionId: string | null;
}

/**
 * Elige con qué asignación actúa el usuario en esta petición, o ninguna si no
 * puede (Arquitectura 8.2).
 *
 * Solo sirven las de un rol permitido y del banco pedido; `super_admin` es de
 * la red y no depende del banco. Sale sin banco ni institución aunque su fila
 * traiga alguno, porque el guard copia al contexto de tenant el banco de la
 * elegida; el trigger `usuario_rol_alcance` impide esa fila, pero esta función
 * no cuenta con él. Si quedan varias, el orden no depende de cómo lleguen las
 * filas:
 *
 * 1. Un rol de banco, que ve todo el banco. Entre dos del mismo banco gana el
 *    que va antes en `ROLES`.
 * 2. La institución de `institucionId`, si la petición la pidió. Si no es de
 *    las del usuario, queda `super_admin` o nada: la cabecera de institución,
 *    como la de banco, no quita el rol de la red.
 * 3. `super_admin`, que no ve datos de ningún banco.
 * 4. La única institución del usuario en el banco. Con varias y sin
 *    `institucionId`, la petición es ambigua y no pasa.
 */
export function elegirAsignacion(
  asignaciones: readonly Asignacion[],
  permitidos: readonly Rol[],
  bancoId?: string,
  institucionId?: string,
): Asignacion | undefined {
  const validas = asignaciones
    .filter((a) => permitidos.includes(a.rol) && (a.rol === 'super_admin' || a.bancoId === bancoId))
    .map((a) => (a.rol === 'super_admin' ? { ...a, bancoId: null, institucionId: null } : a))
    .sort((a, b) => ROLES.indexOf(a.rol) - ROLES.indexOf(b.rol));

  const deBanco = validas.find((a) => a.bancoId !== null && a.institucionId === null);
  if (deBanco) return deBanco;

  const deRed = validas.find((a) => a.rol === 'super_admin');
  const instituciones = validas.filter((a) => a.institucionId !== null);

  if (institucionId) return instituciones.find((a) => a.institucionId === institucionId) ?? deRed;
  return deRed ?? (instituciones.length === 1 ? instituciones[0] : undefined);
}
