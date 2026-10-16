export interface MensajeDeCorreo {
  para: string;
  asunto: string;
  texto: string;
}

/**
 * Puerto de correo saliente (RNF-03, ADR-11). El correo es un canal opcional:
 * quien lo usa no falla si no sale, y le dice a la persona que comparta el
 * enlace a mano (D1 de plataforma-sba-19).
 */
export abstract class EnviadorDeCorreo {
  /** `true` si el servidor de correo aceptó el mensaje. Nunca lanza. */
  abstract enviar(mensaje: MensajeDeCorreo): Promise<boolean>;
}

/** Sin configuración no hay correo. No escribe el mensaje en ningún log. */
export class EnviadorNulo extends EnviadorDeCorreo {
  async enviar(): Promise<boolean> {
    return false;
  }
}
