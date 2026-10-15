import { BadRequestException } from '@nestjs/common';

/** Sin espacios a los lados ni repetidos por dentro. */
export function limpio(valor: string): string {
  return valor.trim().replace(/\s+/g, ' ');
}

/** Obligatorio, limpio y con largo máximo. `que` nombra el campo en el mensaje. */
export function requerido(valor: string, maximo: number, que: string): string {
  const texto = limpio(valor);
  if (!texto) throw new BadRequestException(`${que} no puede quedar vacío.`);
  return conLargoMaximo(texto, maximo, que);
}

/** Opcional: vacío o solo espacios queda en `null`. */
export function opcional(valor: string | null | undefined, maximo: number, que: string) {
  const texto = valor ? limpio(valor) : '';
  return texto ? conLargoMaximo(texto, maximo, que) : null;
}

function conLargoMaximo(valor: string, maximo: number, que: string): string {
  if (valor.length > maximo) {
    throw new BadRequestException(`${que} no puede pasar de ${maximo} caracteres.`);
  }
  return valor;
}
