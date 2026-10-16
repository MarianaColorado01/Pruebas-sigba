import { createTransport } from 'nodemailer';
import { EnviadorSmtp } from './adapters/smtp/enviador-smtp.js';
import { type EnviadorDeCorreo, EnviadorNulo } from './enviador-de-correo.js';

/**
 * SMTP si están `SMTP_URL` y `CORREO_REMITENTE`; si falta alguna, el nulo.
 * Sirve con Resend, Brevo o una cuenta institucional sin tocar código.
 */
export function crearEnviadorDeCorreo(entorno: NodeJS.ProcessEnv = process.env): EnviadorDeCorreo {
  const url = entorno['SMTP_URL']?.trim();
  const remitente = entorno['CORREO_REMITENTE']?.trim();
  if (!url || !remitente) return new EnviadorNulo();
  return new EnviadorSmtp(createTransport(url), remitente);
}
