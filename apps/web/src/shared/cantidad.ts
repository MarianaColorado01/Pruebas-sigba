export const MENSAJE_DE_CANTIDAD =
  'Escribe la cantidad sin puntos; usa coma para los decimales (4200 o 4,5).';

export const MENSAJE_DE_CIFRAS = 'La cantidad admite hasta 7 enteros y 3 decimales (9999999,999).';

export const MENSAJE_DE_CERO = 'La cantidad debe ser mayor que cero.';

export interface CantidadInterpretada {
  /** Con punto decimal y sin ceros sobrantes, lo que lee la API. `null` si está vacía o no vale. */
  valor: string | null;
  error: string | null;
}

const DIGITOS_Y_COMA = /^(\d+)(?:,(\d+))?$/;

/**
 * Lee una cantidad escrita a la colombiana: dígitos y, si hace falta, una
 * coma decimal. El punto se rechaza en vez de adivinar: «4.200» en Colombia es
 * 4200, pero la API lo leería como 4,2 y el libro de inventario quedaría mal.
 *
 * Valida lo mismo que `cantidadPositiva` en la API (hasta siete enteros y tres
 * decimales, mayor que cero) y normaliza igual: «012,50» sale «12.5», para que
 * dos cantidades equivalentes armen la misma carga y el reenvío conserve el comando.
 */
export function interpretarCantidad(texto: string): CantidadInterpretada {
  const limpio = texto.trim();
  if (!limpio) return { valor: null, error: null };
  const partes = DIGITOS_Y_COMA.exec(limpio);
  if (!partes) return { valor: null, error: MENSAJE_DE_CANTIDAD };
  const enteros = (partes[1] ?? '').replace(/^0+(?=\d)/, '');
  const decimales = (partes[2] ?? '').replace(/0+$/, '');
  if (enteros.length > 7 || decimales.length > 3) return { valor: null, error: MENSAJE_DE_CIFRAS };
  if (enteros === '0' && !decimales) return { valor: null, error: MENSAJE_DE_CERO };
  return { valor: decimales ? `${enteros}.${decimales}` : enteros, error: null };
}
