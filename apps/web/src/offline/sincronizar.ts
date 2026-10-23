import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import { pideIniciarSesion } from '@/shared/sesion.ts';
import { colaDb, type ComandoEnCola } from './colaDb.ts';

/** Manda un comando a la API. Lanza `ErrorDeApi` si responde con error. */
export type Enviar = (comando: ComandoEnCola) => Promise<unknown>;

export type ResultadoDeSincronizacion =
  | { tipo: 'al-dia' }
  /** Algo falló por red o por el servidor: volver a intentar a esa hora (epoch en ms). */
  | { tipo: 'reintentar'; en: number }
  /** La sesión venció: la cola espera a que la persona inicie sesión. */
  | { tipo: 'sin-sesion' };

const ESPERA_MAXIMA_MS = 60_000;

/** 2 s, 4 s, 8 s… hasta un minuto entre intentos. */
export function esperaTras(intentos: number): number {
  return Math.min(1000 * 2 ** intentos, ESPERA_MAXIMA_MS);
}

/**
 * Lo que la API rechaza por el contenido del comando o por quien lo envía:
 * validación, algo que no existe, un 409, una regla de negocio o un 403 porque
 * la persona perdió el rol. Reenviarlo no cambia la respuesta, y reintentar un
 * 403 bloquearía para siempre los comandos de atrás. Cualquier otra falla (sin
 * red, 5xx o una página de un proxy) se reintenta: el servidor quizá nunca vio
 * el comando.
 */
const RECHAZOS = new Set([400, 403, 404, 409, 422]);

const MENSAJE_SIN_PERMISO = 'No tienes permiso para registrar esto en este banco.';

function esRechazo(error: unknown): error is ErrorDeApi {
  return error instanceof ErrorDeApi && RECHAZOS.has(error.estado);
}

/**
 * Envía, en orden de creación, los comandos sin confirmar de esa persona en ese
 * banco (ADR-10). Uno `enviado` también se reenvía: si la app se cerró antes de
 * la respuesta, la API lo reconoce por su `comandoId` y no lo duplica
 * (Arquitectura 6.1).
 *
 * Se detiene en el primer error pasajero para respetar el orden. Un rechazo de
 * la API no detiene la cola: el comando queda en conflicto con el motivo y
 * nunca se borra. `forzar` ignora la espera entre intentos, como al volver la red.
 */
export async function sincronizar({
  bancoId,
  usuario,
  enviar,
  forzar = false,
  ahora = Date.now,
  seguir = () => true,
}: {
  bancoId: string;
  usuario: string;
  enviar: Enviar;
  forzar?: boolean;
  ahora?: () => number;
  /** Se consulta antes de cada comando; en falso, la vuelta termina ahí. */
  seguir?: () => boolean;
}): Promise<ResultadoDeSincronizacion> {
  const porEnviar = (await colaDb.listar(bancoId, usuario)).filter(
    (comando) => comando.estado === 'pendiente' || comando.estado === 'enviado',
  );

  for (const comando of porEnviar) {
    if (!seguir()) break;
    if (!forzar && comando.proximoIntento > ahora()) {
      return { tipo: 'reintentar', en: comando.proximoIntento };
    }

    await colaDb.actualizar(comando.comandoId, { estado: 'enviado' });
    try {
      await enviar(comando);
      await colaDb.actualizar(comando.comandoId, { estado: 'confirmado' });
    } catch (error) {
      if (pideIniciarSesion(error)) {
        await colaDb.actualizar(comando.comandoId, { estado: 'pendiente' });
        return { tipo: 'sin-sesion' };
      }
      if (!esRechazo(error)) {
        const intentos = comando.intentos + 1;
        const en = ahora() + esperaTras(intentos);
        await colaDb.actualizar(comando.comandoId, {
          estado: 'pendiente',
          intentos,
          proximoIntento: en,
        });
        return { tipo: 'reintentar', en };
      }
      const { estado, codigo, message } = error;
      await colaDb.actualizar(comando.comandoId, {
        estado: 'conflicto',
        rechazo: {
          estado,
          mensaje: estado === 403 ? MENSAJE_SIN_PERMISO : message,
          ...(codigo ? { codigo } : {}),
        },
      });
    }
  }

  return { tipo: 'al-dia' };
}

export interface Sincronizador {
  /** Sincroniza ya, o al terminar la vuelta en curso si hay una. */
  disparar(forzar?: boolean): Promise<void>;
  /** Cancela el reintento programado. Una vuelta en curso termina el comando que está enviando y para. */
  detener(): void;
}

/**
 * Una sola vuelta de `sincronizar` a la vez, y el reintento programado para la
 * hora que pidió la última. Lo que llegue durante una vuelta se junta en otra.
 */
export function crearSincronizador({
  bancoId,
  usuario,
  enviar,
  ahora = Date.now,
}: {
  bancoId: string;
  usuario: string;
  enviar: Enviar;
  ahora?: () => number;
}): Sincronizador {
  let corriendo = false;
  let otraVuelta: { forzar: boolean } | null = null;
  let detenido = false;
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  async function disparar(forzar = false): Promise<void> {
    if (detenido) return;
    if (corriendo) {
      otraVuelta = { forzar: forzar || (otraVuelta?.forzar ?? false) };
      return;
    }
    corriendo = true;
    clearTimeout(temporizador);
    const resultado = await sincronizar({
      bancoId,
      usuario,
      enviar,
      forzar,
      ahora,
      seguir: () => !detenido,
    }).catch(
      // Si falla IndexedDB, nada se perdió: se intenta otra vez más tarde.
      (): ResultadoDeSincronizacion => ({ tipo: 'reintentar', en: ahora() + ESPERA_MAXIMA_MS }),
    );
    corriendo = false;

    if (otraVuelta && !detenido) {
      const siguiente = otraVuelta;
      otraVuelta = null;
      return disparar(siguiente.forzar);
    }
    if (resultado.tipo === 'reintentar' && !detenido) {
      temporizador = setTimeout(() => void disparar(), Math.max(0, resultado.en - ahora()));
    }
  }

  return {
    disparar,
    detener() {
      detenido = true;
      clearTimeout(temporizador);
    },
  };
}
