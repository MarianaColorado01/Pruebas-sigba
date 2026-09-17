#!/usr/bin/env node
/**
 * Crea un módulo del backend con la forma de Arquitectura 5.3.
 *
 *   pnpm nuevo-modulo <nombre>
 *
 * El módulo de referencia es `apps/api/src/modules/health`: ahí está el
 * ejemplo completo con controlador, servicio con prueba y DTO.
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MODULOS = path.join(RAIZ, 'apps', 'api', 'src', 'modules');
const CARPETAS = ['controllers', 'services', 'repositories', 'dto', 'events'];

function salir(mensaje) {
  console.error(`\n  ${mensaje}\n`);
  process.exit(1);
}

const nombre = process.argv[2];

if (!nombre) {
  salir('Falta el nombre.  Uso: pnpm nuevo-modulo <nombre>');
}

if (!/^[a-z][a-z0-9]*$/.test(nombre)) {
  salir(
    `"${nombre}" no sirve como nombre de módulo.\n` +
      '  Solo minúsculas y dígitos, empezando por letra: inventario, beneficiarios.\n' +
      '  Los nombres del dominio van en español (RS-09).',
  );
}

const existentes = await readdir(MODULOS, { withFileTypes: true });

if (existentes.some((entrada) => entrada.isDirectory() && entrada.name === nombre)) {
  salir(`Ya existe el módulo "${nombre}".`);
}

const Clase = nombre[0].toUpperCase() + nombre.slice(1);
const destino = path.join(MODULOS, nombre);

for (const carpeta of CARPETAS) {
  await mkdir(path.join(destino, carpeta), { recursive: true });
  await writeFile(path.join(destino, carpeta, '.gitkeep'), '');
}

await writeFile(
  path.join(destino, `${nombre}.module.ts`),
  `import { Module } from '@nestjs/common';

/**
 * ${Clase}
 *
 * TODO: responsabilidad del módulo y equipo dueño (Arquitectura 5.2).
 * Escribe en el schema \`${nombre}\` y en ningún otro.
 */
@Module({
  imports: [],
  controllers: [],
  providers: [],
  exports: [],
})
export class ${Clase}Module {}
`,
);

await writeFile(
  path.join(destino, 'index.ts'),
  `/**
 * API pública de \`${nombre}\` (Arquitectura 5.2).
 *
 * Esto es lo único que otro módulo puede importar. Todo lo demás es interno y
 * el lint lo comprueba.
 */

export { ${Clase}Module } from './${nombre}.module.js';
`,
);

console.log(`
  Módulo "${nombre}" creado en apps/api/src/modules/${nombre}

  Falta:
    1. Registrar ${Clase}Module en apps/api/src/app.module.ts,
       importándolo desde './modules/${nombre}/index.js'.
    2. Escribir en ${nombre}.module.ts la responsabilidad y el equipo dueño.
    3. Añadir la ruta a .github/CODEOWNERS con el capitán del equipo.
    4. Crear el schema \`${nombre}\` en apps/api/prisma cuando toque (ADR-05).

  La referencia viva es apps/api/src/modules/health: controlador, servicio con
  prueba y DTO, con las reglas de frontera explicadas en su README.
`);
