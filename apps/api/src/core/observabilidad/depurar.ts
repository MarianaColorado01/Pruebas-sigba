/**
 * Quita de un texto lo que no puede salir a logs ni a Sentry: correos, tokens,
 * credenciales en URL y números de cinco dígitos o más, que pueden ser un
 * documento o un teléfono (Arquitectura 8.6, RNF-M3-08).
 *
 * Es la última barrera, no la primera: el mensaje de un error no debería
 * llevar datos personales. Los UUID se conservan porque son identificadores
 * internos y sin ellos no se puede seguir un error.
 */
const PATRONES: [RegExp, string][] = [
  [/\bBearer\s+\S+/gi, 'Bearer [depurado]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[token]'],
  [/\b[a-z][a-z\d+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, '[url con credenciales]@'],
  [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[correo]'],
];

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
// La primera alternativa es un UUID: lo consume entero para que la segunda no
// lo parta en números.
const UUID_O_NUMERO = /\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b|\d[\d.,/ \t-]{3,}\d/gi;

export function depurar(texto: string): string {
  let resultado = texto;
  for (const [patron, reemplazo] of PATRONES) resultado = resultado.replace(patron, reemplazo);
  return resultado.replace(UUID_O_NUMERO, (encontrado) =>
    UUID.test(encontrado) || encontrado.replace(/\D/g, '').length < 5 ? encontrado : '[número]',
  );
}
