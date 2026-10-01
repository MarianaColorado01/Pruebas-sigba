import { readFileSync } from 'node:fs';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PrismaService, runWithTenantContext } from './core/index.js';
import {
  ArchivoDeCodigosInvalido,
  ImportacionCatalogoService,
  type ReporteDeImportacion,
} from './modules/inventario/index.js';

/**
 * Carga la hoja de códigos del Banco al catálogo (SBA-12).
 *
 *   pnpm --filter @sigba/api build
 *   pnpm --filter @sigba/api importar-codigos prisma/datos/codigos-banco.csv <banco_id>
 *
 * Usa DATABASE_URL, como la API. Se puede correr las veces que haga falta:
 * lo que ya está igual queda sin cambios.
 *
 * No corre si el usuario de DATABASE_URL es superusuario o tiene BYPASSRLS:
 * con él, RLS no separa los bancos y solo queda el filtro por banco_id del
 * adaptador. En local, donde `sigba` es superusuario, se corre con
 * SIGBA_PERMITIR_SIN_RLS=1.
 *
 * Códigos de salida:
 *   0  se importó el archivo entero.
 *   1  alguna fila no se pudo usar y va en el reporte; las demás se importaron.
 *   2  no se pudo empezar: argumentos, archivo ilegible o inválido, falta
 *      DATABASE_URL, banco inexistente o usuario que se salta RLS. No se
 *      importó nada.
 *   3  falló la base o hubo un error inesperado. No se importó nada.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const [archivo, bancoId] = process.argv.slice(2);

if (!archivo || !bancoId || !UUID.test(bancoId)) {
  console.error('Uso: importar-codigos <archivo.csv> <banco_id>');
  console.error('El banco_id es el UUID del banco en plataforma.banco.');
  process.exit(2);
}

// Antes de abrir Nest y la base: una ruta mal escrita no importó nada y sale
// con 2, no con el 1 de las filas rechazadas.
let contenido: Buffer;
try {
  contenido = readFileSync(archivo);
} catch (error) {
  console.error(`No se pudo leer ${archivo}: ${(error as Error).message}`);
  process.exit(2);
}

let app: INestApplicationContext | undefined;
try {
  // Con abortOnError, Nest sale por su cuenta con 1 si un proveedor falla.
  app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
    abortOnError: false,
  });
  process.exitCode = await importar(app, bancoId, contenido);
} catch (error) {
  if (error instanceof ArchivoDeCodigosInvalido) {
    console.error(error.message);
    process.exitCode = 2;
  } else {
    // Sin la traza: a quien corre el comando le basta saber qué falló. Prisma
    // pone antes del motivo la llamada y un trozo del código fuente; el motivo
    // queda en la última línea.
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error(`No se importó nada: ${mensaje.trim().split('\n').at(-1)}`);
    process.exitCode = 3;
  }
} finally {
  await app?.close();
}

async function importar(
  app: INestApplicationContext,
  bancoId: string,
  contenido: Buffer,
): Promise<number> {
  // Sin DATABASE_URL, PrismaService no se conecta (así corren las pruebas
  // unitarias) y el error que da Prisma en la primera consulta termina en
  // «Validation Error Count: 1», que no dice qué falta.
  if (!process.env['DATABASE_URL']) {
    console.error('Falta DATABASE_URL: exporta la misma conexión que usa la API.');
    return 2;
  }

  const prisma = app.get(PrismaService);

  const [rol] = await prisma.$queryRaw<{ sinRls: boolean }[]>`
    SELECT rolsuper OR rolbypassrls AS "sinRls" FROM pg_roles WHERE rolname = current_user`;
  if (rol?.sinRls) {
    if (process.env['SIGBA_PERMITIR_SIN_RLS'] !== '1') {
      console.error('El usuario de DATABASE_URL se salta RLS (superusuario o BYPASSRLS).');
      console.error(
        'Usa un rol sin esos privilegios. En local, donde sigba es superusuario, añade SIGBA_PERMITIR_SIN_RLS=1.',
      );
      return 2;
    }
    console.error(
      'Aviso: el usuario de DATABASE_URL se salta RLS; solo el filtro por banco_id separa los bancos.',
    );
  }

  // categoria.banco_id no tiene FK a plataforma.banco (ADR-05): un UUID mal
  // copiado crearía un catálogo huérfano.
  const banco = await prisma.banco.findUnique({
    where: { id: bancoId },
    select: { nombre: true },
  });
  if (!banco) {
    console.error(`No existe un banco con id ${bancoId} en plataforma.banco.`);
    return 2;
  }

  const reporte = await runWithTenantContext({ bancoId, usuarioId: 'importar-codigos' }, () =>
    app.get(ImportacionCatalogoService).importar(contenido),
  );
  process.stdout.write(`Banco: ${banco.nombre}\n${formatear(reporte)}\n`);
  return reporte.rechazadas.length > 0 ? 1 : 0;
}

function formatear(reporte: ReporteDeImportacion): string {
  const lineas = [
    `Categorías creadas: ${reporte.creadas} · actualizadas: ${reporte.actualizadas} · sin cambios: ${reporte.sinCambios}`,
  ];
  if (reporte.rechazadas.length > 0) {
    lineas.push(`Filas sin usar (${reporte.rechazadas.length}):`);
    for (const { linea, motivo } of reporte.rechazadas) lineas.push(`  línea ${linea}: ${motivo}`);
  }
  if (reporte.productosSinCodigo.length > 0) {
    lineas.push(`Productos sin código (${reporte.productosSinCodigo.length}):`);
    for (const nombre of reporte.productosSinCodigo) lineas.push(`  ${nombre}`);
  }
  return lineas.join('\n');
}
