import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Las reglas de frontera de Arquitectura 5.2 solo sirven mientras estén
 * activas. Esta prueba las ejerce: escribe código que las viola y exige que el
 * lint lo rechace.
 *
 * Sin ella, la regla muere en silencio el día que alguien la relaje, ponga un
 * `eslint-disable` o toque `packages/config/eslint.fronteras.js`. Ese día esta
 * prueba se pone roja y el PR no entra.
 */

const raizApi = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGLA = 'no-restricted-imports';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: raizApi });
});

/** Revisa un fragmento como si viviera en `rutaRelativa`. No toca el disco. */
async function fronterasDe(rutaRelativa: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, {
    filePath: path.join(raizApi, rutaRelativa),
    warnIgnored: false,
  });

  return (resultado?.messages ?? [])
    .filter((mensaje) => mensaje.ruleId === REGLA)
    .map((mensaje) => mensaje.message);
}

describe('un módulo solo entra a otro por su index.ts', () => {
  it('rechaza el import a las carpetas internas de otro módulo', async () => {
    const errores = await fronterasDe(
      'src/modules/beneficiarios/services/cobertura.service.ts',
      `import { StockService } from '../../inventario/repositories/stock.repository.js';
       export const usa = StockService;`,
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('index.ts');
    expect(errores[0]).toContain('inventario');
  });

  it('rechaza también desde la raíz del módulo', async () => {
    const errores = await fronterasDe(
      'src/modules/beneficiarios/beneficiarios.module.ts',
      `import { algo } from '../inventario/services/salidas.service.js';
       export const usa = algo;`,
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('index.ts');
  });

  it('acepta el import por el index.ts', async () => {
    const errores = await fronterasDe(
      'src/modules/beneficiarios/services/cobertura.service.ts',
      `import { InventarioModule } from '../../inventario/index.js';
       export const usa = InventarioModule;`,
    );

    expect(errores).toEqual([]);
  });

  it('inventario lee instituciones solo por InstitucionesService (SBA-33)', async () => {
    const directo = await fronterasDe(
      'src/modules/inventario/repositories/salidas.prisma.repositorio.ts',
      `import { InstitucionesPrismaRepositorio } from '../../beneficiarios/repositories/instituciones.prisma.repositorio.js';
       export const usa = InstitucionesPrismaRepositorio;`,
    );
    const publico = await fronterasDe(
      'src/modules/inventario/repositories/salidas.prisma.repositorio.ts',
      `import { InstitucionesService } from '../../beneficiarios/index.js';
       export const usa = InstitucionesService;`,
    );

    expect(directo).toHaveLength(1);
    expect(directo[0]).toContain('beneficiarios');
    expect(publico).toEqual([]);
  });

  it('M1 y M2 leen bodegas y parámetros solo por el index de plataforma (SBA-34)', async () => {
    const publico = await fronterasDe(
      'src/modules/beneficiarios/services/cobertura.service.ts',
      `import { BodegasService, ParametrosLectura } from '../../plataforma/index.js';
       export const usa = [BodegasService, ParametrosLectura];`,
    );
    const servicio = await fronterasDe(
      'src/modules/inventario/services/salidas.service.ts',
      `import { ParametrosService } from '../../plataforma/services/parametros.service.js';
       export const usa = ParametrosService;`,
    );
    const repositorio = await fronterasDe(
      'src/modules/beneficiarios/repositories/cobertura.prisma.repositorio.ts',
      `import { BodegasPrismaRepositorio } from '../../plataforma/repositories/bodegas.prisma.repositorio.js';
       export const usa = BodegasPrismaRepositorio;`,
    );

    expect(publico).toEqual([]);
    expect(servicio).toHaveLength(1);
    expect(servicio[0]).toContain('plataforma');
    expect(repositorio).toHaveLength(1);
    expect(repositorio[0]).toContain('plataforma');
  });

  it('no estorba dentro del propio módulo', async () => {
    const errores = await fronterasDe(
      'src/modules/inventario/services/salidas.service.ts',
      `import { algo } from '../repositories/movimientos.repository.js';
       export const usa = algo;`,
    );

    expect(errores).toEqual([]);
  });
});

describe('core no importa módulos funcionales', () => {
  it('rechaza que core alcance un módulo', async () => {
    const errores = await fronterasDe(
      'src/core/tenant/contexto.ts',
      `import { InventarioModule } from '../../modules/inventario/index.js';
       export const usa = InventarioModule;`,
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('infraestructura compartida');
  });
});

describe('nadie depende de analitica', () => {
  it('rechaza el import de analitica incluso por su index.ts', async () => {
    const errores = await fronterasDe(
      'src/modules/inventario/services/salidas.service.ts',
      `import { AnaliticaModule } from '../../analitica/index.js';
       export const usa = AnaliticaModule;`,
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('endpoints HTTP');
  });
});

describe('el dominio no importa SDK de proveedores (RNF-03)', () => {
  it('rechaza Prisma dentro de services/', async () => {
    const errores = await fronterasDe(
      'src/modules/inventario/services/recepciones.service.ts',
      `import { PrismaClient } from '@prisma/client';
       export const usa = PrismaClient;`,
    );

    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain('puerto');
  });

  it('acepta Prisma dentro de repositories/', async () => {
    const errores = await fronterasDe(
      'src/modules/inventario/repositories/lotes.repository.ts',
      `import { PrismaClient } from '@prisma/client';
       export const usa = PrismaClient;`,
    );

    expect(errores).toEqual([]);
  });
});
