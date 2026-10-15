/**
 * UUIDv7 (RFC 9562): 48 bits de milisegundos y 74 aleatorios. El celular lo
 * genera para cada comando: es la clave de idempotencia y, hasta que la API
 * responde, el id provisional de lo que crea (Arquitectura 6.1).
 */
export function uuidv7(ahora = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let ms = ahora;
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
