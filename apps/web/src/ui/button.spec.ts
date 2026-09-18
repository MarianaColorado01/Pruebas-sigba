import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button.tsx';

/**
 * `pnpm dlx shadcn@latest add button` reescribe `button.tsx` con la escala de
 * `base-mira`, que es de escritorio denso y deja el botón en 28 px. Esta prueba
 * vive fuera de ese archivo a propósito: el comentario que explica la escala se
 * pierde en el mismo sobrescrito que la escala (Arquitectura 1.3, SBA-62).
 */
describe('Escala táctil del botón', () => {
  it('ningún tamaño de uso en bodega baja del mínimo de toque', () => {
    expect(buttonVariants()).toContain('h-11');
    expect(buttonVariants({ size: 'lg' })).toContain('h-12');
    // El de solo icono es el peor caso con guantes: no tiene texto al lado.
    expect(buttonVariants({ size: 'icon' })).toContain('size-11');
  });
});
