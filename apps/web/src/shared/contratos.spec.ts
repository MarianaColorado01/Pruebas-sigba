import { MODULOS, type Modulo } from '@sigba/shared-types';
import { describe, expect, it } from 'vitest';

/**
 * La PWA compila contra el mismo paquete de contratos que la API
 * (Arquitectura 5.3). Si este import deja de resolver, el tipo dejó de ser
 * compartido y el frontend está redefiniendo lo suyo por su cuenta.
 */
describe('contratos compartidos en la PWA', () => {
  it('ve los mismos módulos que la API', () => {
    const analitica: Modulo = 'analitica';

    expect(MODULOS).toContain(analitica);
    expect(MODULOS).toHaveLength(4);
  });
});
