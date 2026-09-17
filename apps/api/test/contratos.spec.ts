import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULOS, VERSION_DE_CONTRATOS, type Modulo } from '@sigba/shared-types';
import { describe, expect, it } from 'vitest';

/**
 * `packages/shared-types` define los contratos una sola vez para la API y la
 * PWA (Arquitectura 5.3). Si nadie lo importa, nada demuestra que ambas vean el
 * mismo tipo y el paquete se queda decorando el árbol.
 *
 * Esta prueba lo usa de verdad: comprueba que la lista de módulos del contrato
 * y las carpetas que existen en `src/modules` no se separen. Añadir un módulo
 * sin declararlo aquí deja el contrato mintiendo al frontend.
 */

const modulos = path.resolve(fileURLToPath(new URL('../src/modules', import.meta.url)));

/** `health` es plantilla y sonda, no un módulo funcional (Arquitectura 5.2). */
const NO_FUNCIONALES = new Set(['health']);

describe('contratos compartidos', () => {
  it('la lista de módulos del contrato coincide con las carpetas que existen', () => {
    const enDisco = readdirSync(modulos, { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory() && !NO_FUNCIONALES.has(entrada.name))
      .map((entrada) => entrada.name)
      .sort();

    expect(enDisco).toEqual([...MODULOS].sort());
  });

  it('el tipo Modulo se estrecha a los nombres del contrato', () => {
    const inventario: Modulo = 'inventario';

    expect(MODULOS).toContain(inventario);
  });

  it('expone una versión de contrato', () => {
    expect(VERSION_DE_CONTRATOS).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
