import { BadRequestException } from '@nestjs/common';

/**
 * Lo que validan igual todos los comandos que escriben en el libro: la
 * recepción (SBA-24), las bajas y los ajustes (SBA-42). Cantidades y kilos
 * viajan como texto decimal exacto: en coma flotante, 3 × 0,333 no da 0,999.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Decimal(10,3), como la equivalencia: hasta siete enteros y tres decimales,
 * con punto. Su producto cabe en kilos, Decimal(20,6).
 */
const CANTIDAD = /^\d{1,7}(\.\d{1,3})?$/;

/** En minúsculas, para que el hash no cambie por cómo lo escribió el cliente. */
export function uuid(valor: string, sujeto: string): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) {
    throw new BadRequestException(`${sujeto} no es un UUID válido.`);
  }
  return valor.toLowerCase();
}

/**
 * La cantidad sin ceros sobrantes («2.50» da «2.5»), o nulo si no es un
 * decimal mayor que cero con punto y hasta tres decimales.
 */
export function cantidadPositiva(cantidad: string | number): string | null {
  const texto = String(cantidad).trim();
  if (!CANTIDAD.test(texto) || milesimas(texto) === 0n) return null;
  return decimal(milesimas(texto), 3);
}

/** Cantidad (tres decimales) por equivalencia (tres decimales): seis decimales exactos. */
export function kilos(cantidad: string, equivalenciaKg: string): string {
  return decimal(milesimas(cantidad) * milesimas(equivalenciaKg), 6);
}

function milesimas(texto: string): bigint {
  const [enteros = '0', decimales = ''] = texto.split('.');
  return BigInt(enteros + decimales.padEnd(3, '0'));
}

/** El entero escalado como decimal, sin ceros a la derecha: «2.5» y no «2.500». */
function decimal(valor: bigint, escala: number): string {
  const digitos = valor.toString().padStart(escala + 1, '0');
  const enteros = digitos.slice(0, -escala);
  const decimales = digitos.slice(-escala).replace(/0+$/, '');
  return decimales ? `${enteros}.${decimales}` : enteros;
}
