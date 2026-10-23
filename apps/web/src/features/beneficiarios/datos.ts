import { useMutation, useQuery } from '@tanstack/react-query';
import { ErrorDeApi } from '@/shared/clienteHttp';
import { useAsignacion, usePedir } from '@/shared/sesion';
import type {
  BeneficiarioRegistrado,
  BuscarPorDocumento,
  CodigoDeAltaInvalida,
  CodigoDeRegistroRechazado,
  FichaDeBeneficiario,
  InstitucionDto,
  RegistrarBeneficiario,
  TipoDeDocumento,
  TipoDePoblacionDto,
} from '@sigba/shared-types';

/**
 * El registro nominal habla con la API solo en línea. La búsqueda y el alta
 * son mutaciones: su resultado no entra a la caché de consultas ni a
 * IndexedDB, porque son datos personales (Arquitectura 8.6). Las listas de
 * instituciones y tipos de población sí se cachean: no tienen datos de nadie.
 */

/** Claves propias: el directorio (SBA-86) cachea las instituciones con las inactivas. */
function useLista<T>(nombre: string, ruta: string) {
  const pedir = usePedir();
  const bancoId = useAsignacion()?.bancoId;
  return useQuery({
    queryKey: ['beneficiarios', 'registro', nombre, bancoId],
    queryFn: () => pedir<T[]>(ruta),
    enabled: Boolean(bancoId),
  });
}

export const useInstituciones = () => useLista<InstitucionDto>('instituciones', '/instituciones');

export const useTiposDePoblacion = () =>
  useLista<TipoDePoblacionDto>('tipos-de-poblacion', '/tipos-de-poblacion');

export function useBuscarPersona() {
  const pedir = usePedir();
  return useMutation({
    mutationFn: (busqueda: BuscarPorDocumento) =>
      pedir<FichaDeBeneficiario>('/beneficiarios/busqueda', {
        method: 'POST',
        body: JSON.stringify(busqueda),
      }),
  });
}

export function useRegistrar() {
  const pedir = usePedir();
  return useMutation({
    mutationFn: (alta: RegistrarBeneficiario) =>
      pedir<BeneficiarioRegistrado>('/beneficiarios', {
        method: 'POST',
        body: JSON.stringify(alta),
      }),
  });
}

/**
 * `AAAA-MM-DD` del día en el navegador. `toISOString()` da el día en UTC, que
 * en Colombia ya es mañana desde las 19:00.
 */
export function fechaLocal(fecha = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/** Años cumplidos en `hoy` por quien nació en `fecha` (`AAAA-MM-DD`). */
export function edad(fecha: string, hoy = new Date()): number {
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  const yaCumplio =
    hoy.getMonth() + 1 > mes || (hoy.getMonth() + 1 === mes && hoy.getDate() >= dia);
  return hoy.getFullYear() - anio - (yaCumplio ? 0 : 1);
}

const DE_MENORES: readonly TipoDeDocumento[] = ['ti', 'registro_civil'];

/**
 * Si es menor de edad. Manda la fecha de nacimiento, como en la API; sin
 * fecha todavía, el tipo de documento lo anticipa.
 */
export function esMenor(tipo: TipoDeDocumento, fechaNacimiento: string, hoy = new Date()) {
  return fechaNacimiento ? edad(fechaNacimiento, hoy) < 18 : DE_MENORES.includes(tipo);
}

const RECHAZOS: Record<CodigoDeRegistroRechazado, string> = {
  duplicidad:
    'Esta persona ya está activa en otra institución. No se creó otra membresía: quedó una alerta de duplicidad para que coordinación decida.',
  tipo_distinto:
    'Ese número ya está registrado con otro tipo de documento. Revisa el tipo; si está bien, el caso lo resuelve coordinación.',
  registro_simultaneo:
    'Otra alta de esta persona terminó primero. Toca Registrar otra vez para ver el resultado.',
};

const INVALIDAS: Record<CodigoDeAltaInvalida, string> = {
  otorgante_requerido: 'Elige cuál representante autorizó por el menor.',
  otorgante_invalido:
    'Quien autoriza por el menor tiene que ser su representante. Busca el documento otra vez.',
};

/** `hasOwn` y no `in`: `'toString' in {}` es verdadero. */
const segun = <C extends string>(tabla: Record<C, string>, codigo: string | undefined) =>
  codigo !== undefined && Object.hasOwn(tabla, codigo) ? tabla[codigo as C] : undefined;

/**
 * Qué decirle a la persona cuando la API rechaza. Nunca muestra el `message`
 * de la API: un error no debe repetir el documento ni otros datos personales.
 */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ErrorDeApi)) {
    return 'Sin conexión con el servidor. No se guardó nada: inténtalo de nuevo cuando tengas señal.';
  }
  if (error.estado === 409) {
    return (
      segun(RECHAZOS, error.codigo) ??
      'No se pudo registrar por un conflicto. Busca el documento otra vez.'
    );
  }
  if (error.estado === 400) {
    return segun(INVALIDAS, error.codigo) ?? 'Algún dato no es válido. Revisa el formulario.';
  }
  if (error.estado === 403) return 'Tu rol no puede registrar beneficiarios en este banco.';
  if (error.estado === 404) {
    return 'La institución o el tipo de población ya no está activo. Elige otro.';
  }
  return 'No se pudo guardar. Inténtalo de nuevo.';
}
