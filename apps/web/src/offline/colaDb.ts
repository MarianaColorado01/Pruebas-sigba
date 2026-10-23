import Dexie, { liveQuery, type Table } from 'dexie';

/**
 * Las rutas a las que la cola puede enviar. Es una lista cerrada a propósito:
 * solo entran comandos de inventario, nunca datos personales de beneficiarios
 * (Arquitectura 8.6). Salidas se agrega cuando exista su pantalla (ADR-10).
 */
export const RUTA_DE_COMANDO = {
  recepcion: '/recepciones',
} as const;

export type TipoDeComando = keyof typeof RUTA_DE_COMANDO;

/**
 * `enviado`: salió hacia la API y no ha respondido. `conflicto`: la API lo
 * rechazó por una regla de negocio, un 409 o falta de permiso; se conserva para conciliar.
 */
export type EstadoDeComando = 'pendiente' | 'enviado' | 'confirmado' | 'conflicto';

export interface ComandoEnCola {
  /** UUIDv7 del celular: clave de idempotencia en la API y orden de envío. */
  comandoId: string;
  bancoId: string;
  /** `sub` de Auth0: solo esa persona puede enviarlo, con su token. */
  usuario: string;
  tipo: TipoDeComando;
  /** El cuerpo sin `comandoId`; la cola lo agrega al enviar. */
  carga: Record<string, unknown>;
  estado: EstadoDeComando;
  /** ISO 8601, con el reloj del dispositivo. */
  creadoEn: string;
  /** Envíos fallidos por red o por error del servidor. */
  intentos: number;
  /** Epoch en ms; antes de esa hora no se reintenta salvo que vuelva la red. */
  proximoIntento: number;
  /** Lo que respondió la API al rechazarlo. */
  rechazo?: { estado: number; codigo?: string; mensaje: string };
}

const DIAS_DE_CONFIRMADOS = 7;

/** Base aparte, como `sigba-stock`: no toca el esquema de `sigba-offline`. */
class BaseDeCola extends Dexie {
  comandos!: Table<ComandoEnCola, string>;

  constructor() {
    super('sigba-cola');
    this.version(1).stores({ comandos: '&comandoId, [bancoId+usuario]' });
  }
}

const base = new BaseDeCola();

/** Los comandos de esa persona en ese banco, en el orden en que se crearon. */
function listar(bancoId: string, usuario: string): Promise<ComandoEnCola[]> {
  return base.comandos.where('[bancoId+usuario]').equals([bancoId, usuario]).sortBy('comandoId');
}

export const colaDb = {
  listar,

  agregar(comando: ComandoEnCola): Promise<string> {
    return base.comandos.add(comando);
  },

  /**
   * Guarda el comando salvo que ya exista uno con su `comandoId` para esa misma
   * persona y banco; devuelve el que quedó guardado. Si el `comandoId` es de
   * otro banco u otra persona lanza un error: un UUIDv7 repetido es un fallo
   * del cliente, y devolver ese registro mostraría la carga de otro banco.
   */
  agregarSiNoExiste(comando: ComandoEnCola): Promise<ComandoEnCola> {
    return base.transaction('rw', base.comandos, async () => {
      const existente = await base.comandos.get(comando.comandoId);
      if (existente) {
        if (existente.bancoId !== comando.bancoId || existente.usuario !== comando.usuario) {
          throw new Error('Ese comandoId ya lo usa otro banco u otra persona en este celular.');
        }
        return existente;
      }
      await base.comandos.add(comando);
      return comando;
    });
  },

  async actualizar(comandoId: string, cambios: Partial<ComandoEnCola>): Promise<void> {
    await base.comandos.update(comandoId, cambios);
  },

  /**
   * Borra los confirmados de más de 7 días, de cualquier banco y persona de este
   * celular. La API los reconoce por su `comandoId`, así que no se pierde nada.
   */
  async purgarConfirmados(ahora = Date.now()): Promise<void> {
    const limite = ahora - DIAS_DE_CONFIRMADOS * 24 * 60 * 60 * 1000;
    await base.comandos
      .filter((c) => c.estado === 'confirmado' && Date.parse(c.creadoEn) < limite)
      .delete();
  },

  /** Llama a `alCambiar` con la lista y otra vez cada vez que cambia. Devuelve cómo dejar de observar. */
  observar(
    bancoId: string,
    usuario: string,
    alCambiar: (comandos: ComandoEnCola[]) => void,
  ): () => void {
    const suscripcion = liveQuery(() => listar(bancoId, usuario)).subscribe({
      next: alCambiar,
      error: () => undefined,
    });
    return () => suscripcion.unsubscribe();
  },
};
