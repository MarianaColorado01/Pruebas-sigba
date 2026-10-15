import { type AsignacionDeUsuario, ROLES, type Rol } from '@sigba/shared-types';

/** Cómo se le dice a cada rol en pantalla. */
export const NOMBRE_DE_ROL: Record<Rol, string> = {
  super_admin: 'Administración de la red',
  admin_banco: 'Administración del banco',
  coordinacion: 'Coordinación',
  operario_bodega: 'Bodega',
  voluntario: 'Voluntariado',
  consulta: 'Consulta',
  institucion: 'Institución',
};

/** Lo que se muestra como nombre de la opción: el banco, o la red para `super_admin`. */
export const nombreDeOpcion = (opcion: AsignacionDeUsuario) => opcion.bancoNombre ?? 'Toda la red';

/** Identifica una opción sin depender de que el objeto sea el mismo entre consultas. */
export const claveDe = ({ rol, bancoId, institucionId }: AsignacionDeUsuario) =>
  `${rol}|${bancoId ?? ''}|${institucionId ?? ''}`;

/**
 * Las asignaciones entre las que la persona elige. Con dos roles en el mismo
 * banco queda uno, el de más precedencia: es con el que la API actúa en ese
 * banco cuando no se le manda institución. Cada institución sigue aparte.
 */
export function opcionesDe(asignaciones: readonly AsignacionDeUsuario[]): AsignacionDeUsuario[] {
  const mejores = new Map<string, AsignacionDeUsuario>();
  for (const asignacion of asignaciones) {
    const lugar = `${asignacion.bancoId ?? ''}|${asignacion.institucionId ?? ''}`;
    const actual = mejores.get(lugar);
    if (!actual || ROLES.indexOf(asignacion.rol) < ROLES.indexOf(actual.rol)) {
      mejores.set(lugar, asignacion);
    }
  }
  return [...mejores.values()];
}

/**
 * Con qué opción arrancar sin preguntar: la única que hay o la del banco que
 * eligió la última vez. Si no hay cómo saberlo, `null` y se pregunta.
 */
export function opcionInicial(
  opciones: readonly AsignacionDeUsuario[],
  bancoRecordado: string | null,
): AsignacionDeUsuario | null {
  if (opciones.length === 1) return opciones[0] ?? null;
  if (!bancoRecordado) return null;
  return opciones.find((opcion) => opcion.bancoId === bancoRecordado) ?? null;
}

const CLAVE_BANCO = 'sigba.bancoId';

/**
 * El último banco elegido, para no preguntar en cada inicio de sesión (D13).
 * Solo el id: nunca tokens ni datos personales (ADR-06). El almacenamiento
 * puede no estar (navegación privada, sitio bloqueado) y eso no impide entrar.
 */
export function bancoRecordado(): string | null {
  try {
    return localStorage.getItem(CLAVE_BANCO);
  } catch {
    return null;
  }
}

export function recordarBanco(bancoId: string | null): void {
  try {
    if (bancoId) localStorage.setItem(CLAVE_BANCO, bancoId);
    else localStorage.removeItem(CLAVE_BANCO);
  } catch {
    // Sin almacenamiento, la próxima vez se vuelve a preguntar.
  }
}
