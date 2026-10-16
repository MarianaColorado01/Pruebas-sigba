import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnviadorSmtp } from './adapters/smtp/enviador-smtp.js';
import { crearEnviadorDeCorreo } from './crear-enviador-de-correo.js';
import { EnviadorNulo } from './enviador-de-correo.js';

const mensaje = {
  para: 'persona@example.invalid',
  asunto: 'Invitación',
  texto: 'https://sigba.example/invitacion/token-secreto',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crearEnviadorDeCorreo', () => {
  it('sin SMTP_URL o sin CORREO_REMITENTE usa el nulo', () => {
    expect(crearEnviadorDeCorreo({})).toBeInstanceOf(EnviadorNulo);
    expect(crearEnviadorDeCorreo({ SMTP_URL: 'smtp://localhost:2525' })).toBeInstanceOf(
      EnviadorNulo,
    );
    expect(crearEnviadorDeCorreo({ CORREO_REMITENTE: 'sigba@example.invalid' })).toBeInstanceOf(
      EnviadorNulo,
    );
  });

  it('con las dos variables usa SMTP', () => {
    const enviador = crearEnviadorDeCorreo({
      SMTP_URL: 'smtp://usuario:clave@localhost:2525',
      CORREO_REMITENTE: 'SIGBA <sigba@example.invalid>',
    });

    expect(enviador).toBeInstanceOf(EnviadorSmtp);
  });
});

describe('EnviadorNulo', () => {
  it('no envía y lo dice', async () => {
    await expect(new EnviadorNulo().enviar()).resolves.toBe(false);
  });
});

describe('EnviadorSmtp', () => {
  it('entrega el mensaje con el remitente configurado', async () => {
    const sendMail = vi.fn().mockResolvedValue({});

    await expect(
      new EnviadorSmtp({ sendMail }, 'sigba@example.invalid').enviar(mensaje),
    ).resolves.toBe(true);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'sigba@example.invalid',
      to: mensaje.para,
      subject: mensaje.asunto,
      text: mensaje.texto,
    });
  });

  it('si el servidor falla devuelve false y no escribe destinatario ni enlace', async () => {
    const sendMail = vi.fn().mockRejectedValue(new Error(`rechazado ${mensaje.para}`));
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      new EnviadorSmtp({ sendMail }, 'sigba@example.invalid').enviar(mensaje),
    ).resolves.toBe(false);
    const escrito = JSON.stringify(aviso.mock.calls);
    expect(escrito).not.toContain(mensaje.para);
    expect(escrito).not.toContain('token-secreto');
  });
});
