import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service.js';
import { AuditoriaInterceptor, AUDITAR_LECTURA } from './auditoria.interceptor.js';

describe('AuditoriaInterceptor', () => {
  function crearInterceptor(registrar: ReturnType<typeof vi.fn>) {
    return new AuditoriaInterceptor(
      {
        getAllAndOverride: vi
          .fn()
          .mockReturnValue({ entidad: 'beneficiario', finalidad: 'atencion' }),
      } as never,
      {
        $transaction: (fn: (tx: never) => Promise<void>) =>
          fn({ $executeRaw: vi.fn().mockResolvedValue(0) } as never),
      } as never,
      { registrar } as unknown as AuditService,
    );
  }

  function crearContexto(respuesta: unknown) {
    return {
      contexto: {
        getHandler: () => vi.fn(),
        getClass: () => vi.fn(),
        switchToHttp: () => ({ getRequest: () => ({}) }),
      },
      siguiente: { handle: () => of(respuesta) },
    };
  }

  it('espera la auditoría antes de entregar la respuesta, sin copiar su contenido', async () => {
    let completarRegistro!: () => void;
    const entradas: unknown[] = [];
    const registrar = vi.fn((_tx: unknown, entrada: unknown) => {
      entradas.push(entrada);
      return new Promise<void>((resolve) => {
        completarRegistro = resolve;
      });
    });
    const interceptor = crearInterceptor(registrar);
    const respuesta = { id: '55555555-5555-4555-8555-555555555555', documento: 'dato-personal' };
    const { contexto, siguiente } = crearContexto(respuesta);
    const siguienteRespuesta = vi.fn();
    const resultado = lastValueFrom(
      interceptor.intercept(contexto as never, siguiente as never),
    ).then((valor) => {
      siguienteRespuesta(valor);
      return valor;
    });

    await vi.waitFor(() => expect(registrar).toHaveBeenCalledOnce());
    expect(siguienteRespuesta).not.toHaveBeenCalled();
    completarRegistro();

    expect(await resultado).toBe(respuesta);
    expect(registrar).toHaveBeenCalledWith(expect.anything(), {
      accion: 'leer',
      entidad: 'beneficiario',
      entidadId: '55555555-5555-4555-8555-555555555555',
      finalidad: 'atencion',
    });
    expect(entradas[0]).not.toHaveProperty('documento');
    expect(AUDITAR_LECTURA).toBe('sigba:auditar-lectura');
  });

  it('no entrega la respuesta cuando falla la auditoría', async () => {
    const registrar = vi.fn().mockRejectedValue(new Error('fallo de auditoría'));
    const interceptor = crearInterceptor(registrar);
    const { contexto, siguiente } = crearContexto({
      id: '55555555-5555-4555-8555-555555555555',
      documento: 'dato-personal',
    });
    const recibida = vi.fn();
    const fallo = lastValueFrom(interceptor.intercept(contexto as never, siguiente as never)).then(
      recibida,
    );

    await expect(fallo).rejects.toThrow('fallo de auditoría');
    expect(recibida).not.toHaveBeenCalled();
  });
});
