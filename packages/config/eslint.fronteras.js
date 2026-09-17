/**
 * Reglas de frontera entre módulos del backend.
 * Fuente: Documento de Arquitectura v1.2, sección 5.2 «Reglas de frontera»,
 * ADR-01 y RNF-03 del alcance M3.
 *
 * Lo que se verifica:
 *
 *  1. Un módulo importa de otro solo lo que este exporta desde su `index.ts`.
 *     `../inventario/index.js` pasa; `../inventario/services/loquesea.js` no.
 *  2. `core` no importa módulos funcionales. Es infraestructura compartida,
 *     no un cuarto módulo de alcance.
 *  3. Nadie importa `analitica`: solo expone endpoints HTTP.
 *  4. La lógica de dominio (`services/`, `events/`) no importa SDK de
 *     proveedores. Los adaptadores implementan los puertos de `core` (RNF-03).
 *
 * Las fronteras se comprueban sobre rutas relativas porque `apps/api` es ESM
 * y los imports llevan la ruta explícita. No hay alias que mantener en paralelo.
 */

/** Módulos funcionales del backend. Sección 5.2. */
export const MODULOS = ['plataforma', 'inventario', 'beneficiarios', 'analitica'];

/** Módulo que nadie puede importar: solo expone endpoints HTTP. */
export const MODULO_SIN_CONSUMIDORES = 'analitica';

/**
 * SDK de proveedores que la lógica de dominio no puede importar.
 * Cuando añadas un adaptador, añade aquí su SDK.
 */
export const SDK_DE_PROVEEDORES = [
  '@prisma/client',
  'prisma',
  'pg',
  'pg-boss',
  '@aws-sdk/*',
  'auth0',
  'express-oauth2-jwt-bearer',
  'jwks-rsa',
  '@sentry/*',
  'nodemailer',
  'openai',
  '@anthropic-ai/*',
  '@google-cloud/*',
];

/** Cualquier ruta que entre a una subcarpeta del módulo: dos o más segmentos tras su nombre. */
const haciaDentroDe = (nombre) => [`../**/${nombre}/*/*`, `../**/${nombre}/*/*/**`];

/** El módulo entero, incluido su index. */
const haciaTodoDe = (nombre) => [`../**/${nombre}`, `../**/${nombre}/**`];

const MSG_INDEX = (otro) =>
  `Un módulo solo importa de otro a través de su index.ts. Importa "../${otro}/index.js" ` +
  `(o "../../${otro}/index.js"). Si lo que necesitas no está exportado ahí, no es API ` +
  `pública: pídeselo al equipo dueño de ${otro} (Arquitectura 5.2).`;

const MSG_CORE_NO_IMPORTA_MODULOS =
  'core no importa módulos funcionales. Es infraestructura compartida, no un cuarto ' +
  'módulo de alcance: los módulos dependen de core, nunca al revés (Arquitectura 5.2, ADR-01).';

const MSG_ANALITICA =
  'Ningún módulo depende de analitica: solo expone endpoints HTTP y consume eventos. ' +
  'Si necesitas un dato suyo, algo está al revés (Arquitectura 5.2).';

const MSG_SDK =
  'La lógica de dominio no importa SDK de proveedores. Define el puerto en core y pon la ' +
  'dependencia en repositories/ o en un adaptador de infraestructura (RNF-03).';

function patronesDeModulo(modulo) {
  const patrones = [];

  for (const otro of MODULOS) {
    if (otro === modulo) continue;
    if (otro === MODULO_SIN_CONSUMIDORES) {
      patrones.push({ group: haciaTodoDe(otro), message: MSG_ANALITICA });
    } else {
      patrones.push({ group: haciaDentroDe(otro), message: MSG_INDEX(otro) });
    }
  }

  return patrones;
}

/**
 * @param {{ raiz?: string }} opciones  raíz del código de la API
 * @returns {import('eslint').Linter.Config[]}
 */
export function fronteras({ raiz = 'src' } = {}) {
  const bloques = [];

  for (const modulo of MODULOS) {
    const patrones = patronesDeModulo(modulo);

    bloques.push({
      name: `fronteras/${modulo}`,
      files: [`${raiz}/modules/${modulo}/**/*.ts`],
      rules: { 'no-restricted-imports': ['error', { patterns: patrones }] },
    });

    // ESLint reemplaza la regla completa en el bloque posterior en vez de
    // sumarla, así que el bloque del dominio repite los patrones de frontera.
    bloques.push({
      name: `fronteras/${modulo}/dominio`,
      files: [
        `${raiz}/modules/${modulo}/services/**/*.ts`,
        `${raiz}/modules/${modulo}/events/**/*.ts`,
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: [...patrones, { group: SDK_DE_PROVEEDORES, message: MSG_SDK }] },
        ],
      },
    });
  }

  bloques.push({
    name: 'fronteras/core',
    files: [`${raiz}/core/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: MODULOS.flatMap(haciaTodoDe).concat('../**/modules', '../**/modules/**'),
              message: MSG_CORE_NO_IMPORTA_MODULOS,
            },
          ],
        },
      ],
    },
  });

  return bloques;
}

export default fronteras;
