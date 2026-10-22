import { HttpException } from '@nestjs/common';
import { depurar } from './depurar.js';

/**
 * Lo que sale de la API cuando falla una petición: sin cuerpo, sin cabeceras,
 * sin la URL real (puede llevar un documento en la consulta) y sin el mensaje
 * de un error inesperado (Arquitectura 8.6).
 */
export interface ErrorReportado {
  /** 32 caracteres hexadecimales: el `peticionId` que recibe la PWA. */
  peticionId: string;
  nombre: string;
  mensaje: string;
  /** Líneas `at ...` de la pila: ubicaciones de código, no datos. */
  marcos: string[];
  metodo: string;
  /** Patrón de la ruta, p. ej. `/api/v1/referencias/:id`. */
  ruta?: string;
  modulo?: string;
  usuarioId?: string;
  bancoId?: string;
}

export type ContextoDelError = Omit<ErrorReportado, 'nombre' | 'mensaje' | 'marcos'>;

/**
 * Un error inesperado sale sin su mensaje: el de Prisma o Postgres puede
 * repetir los datos de la consulta, nombres y direcciones incluidos, y eso no
 * lo atrapa ningún patrón. Queda su código (p. ej. `P2002`) y la pila. Solo el
 * mensaje de una `HttpException`, que escribió el equipo, viaja depurado.
 */
function mensajeDe(error: Error): string {
  if (error instanceof HttpException) return depurar(error.message);
  const codigo: unknown = (error as { code?: unknown }).code;
  return typeof codigo === 'string' ? `código ${depurar(codigo)}` : '';
}

/** Separa el mensaje de la pila. Un valor que no es `Error` no se copia. */
export function describirError(error: unknown, contexto: ContextoDelError): ErrorReportado {
  if (!(error instanceof Error)) {
    return { ...contexto, nombre: typeof error, mensaje: '', marcos: [] };
  }
  const lineas = error.stack?.split('\n') ?? [];
  return {
    ...contexto,
    nombre: depurar(error.name),
    mensaje: mensajeDe(error),
    marcos: lineas.filter((linea) => /^\s+at /.test(linea)).map((linea) => linea.trim()),
  };
}
