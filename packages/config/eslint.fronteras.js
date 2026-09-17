/**
 * Reglas de frontera entre módulos del backend.
 * Fuente: Documento de Arquitectura v1.2, sección 5.2 «Reglas de frontera»,
 * ADR-01 y RNF-03 del alcance M3.
 *
 * Lo que se verifica aquí:
 *
 *  1. Un módulo importa de otro solo lo que este exporta desde `index.ts`,
 *     y lo hace por el alias `@modules/<nombre>`. Las rutas relativas hacia
 *     otro módulo quedan prohibidas porque saltan la API pública.
 *  2. `core` no importa módulos funcionales. Es infraestructura compartida,
 *     no un cuarto módulo de alcance.
 *  3. Ningún módulo depende de `analitica`: solo expone endpoints HTTP.
 *  4. La lógica de dominio (`services/`, `events/`) no importa SDK de
 *     proveedores. Los adaptadores implementan los puertos de `core` (RNF-03).
 */

/** Módulos funcionales del backend. Sección 5.2. */
export const MODULOS = ['plataforma', 'inventario', 'beneficiarios', 'analitica'];

/** Módulo que nadie puede importar: solo expone endpoints HTTP. */
export const MODULO_SIN_CONSUMIDORES = 'analitica';

/**
 * SDK de proveedores que la lógica de dominio no puede importar.
 * Si añades un adaptador nuevo, añade aquí su SDK.
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

const MSG_INDEX = (otro) =>
  `Un módulo solo importa de otro a través de su index.ts. Usa "@modules/${otro}", ` +
  `que resuelve a modules/${otro}/index.ts. Si lo que necesitas no está exportado ahí, ` +
  `no es API pública: pídeselo al equipo dueño (Arquitectura 5.2).`;

const MSG_CORE_RELATIVO =
  'Importa core por su alias "@core/...", no por ruta relativa (Arquitectura 5.2).';

const MSG_CORE_NO_IMPORTA_MODULOS =
  'core no importa módulos funcionales. core es infraestructura compartida, ' +
  'no un cuarto módulo de alcance (Arquitectura 5.2, ADR-01).';

const MSG_ANALITICA =
  'Ningún módulo depende de analitica: solo expone endpoints HTTP. ' +
  'Si necesitas un dato suyo, el dueño publica un evento (Arquitectura 5.2).';

const MSG_SDK =
  'El dominio no importa SDK de proveedores. Define un puerto en core y ponlo ' +
  'en repositories/ o en un adaptador de infraestructura (RNF-03).';

/** Bloquea el acceso relativo a un directorio hermano, a cualquier profundidad. */
const relativoHacia = (nombre) => [`../**/${nombre}`, `../**/${nombre}/**`];

function patronesDeModulo(modulo) {
  const patrones = [];

  for (const otro of MODULOS) {
    if (otro === modulo) continue;
    patrones.push({ group: relativoHacia(otro), message: MSG_INDEX(otro) });
  }

  patrones.push({ group: relativoHacia('core'), message: MSG_CORE_RELATIVO });
  patrones.push({
    group: ['@modules/*/*', '@modules/*/**'],
    message: 'El alias @modules apunta al index.ts del módulo. No lo uses para entrar a sus carpetas.',
  });

  if (modulo !== MODULO_SIN_CONSUMIDORES) {
    patrones.push({ group: [`@modules/${MODULO_SIN_CONSUMIDORES}`], message: MSG_ANALITICA });
  }

  return patrones;
}

/**
 * @param {{ raiz?: string }} opciones  raíz del código de la API dentro del repo
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

    // La lógica de dominio arrastra además la prohibición de SDK (RNF-03).
    // ESLint reemplaza la regla completa en el bloque posterior, así que este
    // repite los patrones de frontera en lugar de añadirse a ellos.
    bloques.push({
      name: `fronteras/${modulo}/dominio`,
      files: [
        `${raiz}/modules/${modulo}/services/**/*.ts`,
        `${raiz}/modules/${modulo}/events/**/*.ts`,
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [...patrones, { group: SDK_DE_PROVEEDORES, message: MSG_SDK }],
          },
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
            { group: ['../**/modules', '../**/modules/**'], message: MSG_CORE_NO_IMPORTA_MODULOS },
            { group: ['@modules/*', '@modules/*/**'], message: MSG_CORE_NO_IMPORTA_MODULOS },
          ],
        },
      ],
    },
  });

  return bloques;
}

export default fronteras;
