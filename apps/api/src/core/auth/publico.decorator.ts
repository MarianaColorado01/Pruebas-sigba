import { SetMetadata } from '@nestjs/common';

export const RUTA_PUBLICA = 'sigba:ruta-publica';

export function Publico() {
  return SetMetadata(RUTA_PUBLICA, true);
}
