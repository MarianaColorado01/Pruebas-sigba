import { Logger } from '@nestjs/common';
import type { Transporter } from 'nodemailer';
import { EnviadorDeCorreo, type MensajeDeCorreo } from '../../enviador-de-correo.js';

/**
 * Adaptador SMTP con nodemailer. Un fallo del servidor no rompe a quien llama:
 * devuelve `false` y deja en el log solo que falló. Ni el destinatario ni el
 * texto, que puede llevar un enlace de invitación (Arquitectura 8.6).
 */
export class EnviadorSmtp extends EnviadorDeCorreo {
  private readonly log = new Logger(EnviadorSmtp.name);

  constructor(
    private readonly transporte: Pick<Transporter, 'sendMail'>,
    private readonly remitente: string,
  ) {
    super();
  }

  async enviar({ para, asunto, texto }: MensajeDeCorreo): Promise<boolean> {
    try {
      await this.transporte.sendMail({
        from: this.remitente,
        to: para,
        subject: asunto,
        text: texto,
      });
      return true;
    } catch {
      this.log.warn('El servidor SMTP no aceptó un correo.');
      return false;
    }
  }
}
