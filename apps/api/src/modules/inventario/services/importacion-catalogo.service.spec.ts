import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CategoriaDelBanco,
  CategoriasRepositorio,
  type ResultadoDeGuardado,
} from './categoria.js';
import {
  ArchivoDeCodigosInvalido,
  ImportacionCatalogoService,
  leerCsv,
  planificarCategorias,
} from './importacion-catalogo.service.js';

/** Guarda por código, como la clave única (banco_id, codigo). */
class RepositorioEnMemoria extends CategoriasRepositorio {
  categorias = new Map<string, CategoriaDelBanco>();
  productosPendientes: string[] = [];

  async guardar(categorias: CategoriaDelBanco[]): Promise<ResultadoDeGuardado> {
    const resultado = { creadas: 0, actualizadas: 0, sinCambios: 0 };
    for (const categoria of categorias) {
      const actual = this.categorias.get(categoria.codigo);
      if (!actual) resultado.creadas++;
      else if (JSON.stringify(actual) === JSON.stringify(categoria)) resultado.sinCambios++;
      else resultado.actualizadas++;
      this.categorias.set(categoria.codigo, categoria);
    }
    return resultado;
  }

  async productosSinCodigo(): Promise<string[]> {
    return this.productosPendientes;
  }
}

const CABECERA = 'linea_codigo;linea;codigo;subcategoria;productos';

/** Solo las celdas, para las pruebas que no miran el número de línea. */
const celdas = (texto: string) => leerCsv(texto).map((f) => f.celdas);

describe('leerCsv', () => {
  it('lee filas separadas por punto y coma, como exporta Excel en español', () => {
    expect(celdas('a;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('lee filas separadas por coma cuando la cabecera las usa', () => {
    expect(celdas('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('elige el separador con la primera línea que tiene contenido', () => {
    expect(celdas('\n\na;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('respeta comillas, separadores dentro de ellas y comillas dobladas', () => {
    expect(celdas('a;b\n"Harina de arroz; maíz";"dice ""hola"""')).toEqual([
      ['a', 'b'],
      ['Harina de arroz; maíz', 'dice "hola"'],
    ]);
  });

  it('toma como texto una comilla que no está al principio de la celda', () => {
    expect(celdas('a;b\nE001;TV 32" pulgadas\nE002;Radio')).toEqual([
      ['a', 'b'],
      ['E001', 'TV 32" pulgadas'],
      ['E002', 'Radio'],
    ]);
  });

  it('rechaza el archivo entero si unas comillas abren y no cierran', () => {
    expect(() => leerCsv('a;b\nE001;"TV\nE002;Radio\nE003;Nevera')).toThrow(
      new ArchivoDeCodigosInvalido('La fila de la línea 2 abre comillas y no las cierra.'),
    );
  });

  it('quita la marca BOM que deja Excel al principio y salta líneas vacías', () => {
    expect(celdas('\uFEFFa;b\n\n1;2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('numera cada fila con la línea del archivo donde empieza', () => {
    expect(leerCsv('a;b\n\n\n1;"dos\r\nlíneas"\n3;4')).toEqual([
      { linea: 1, celdas: ['a', 'b'] },
      { linea: 4, celdas: ['1', 'dos\nlíneas'] },
      { linea: 6, celdas: ['3', '4'] },
    ]);
  });
});

describe('planificarCategorias', () => {
  it('convierte cada fila en una categoría con código, nombre, línea y descripción', () => {
    const plan = planificarCategorias(
      leerCsv(`${CABECERA}\nCE8;Cereales, raíces;C801;Cereales;Arroz blanco - Arroz integral`),
    );

    expect(plan.rechazadas).toEqual([]);
    expect(plan.categorias).toEqual([
      {
        codigo: 'C801',
        nombre: 'Cereales',
        linea: 'Cereales, raíces',
        descripcion: 'Arroz blanco - Arroz integral',
      },
    ]);
  });

  it('acepta las columnas en otro orden, con mayúsculas y con tildes en la cabecera', () => {
    const plan = planificarCategorias(leerCsv('Subcategoría;CÓDIGO\nAgua;B301'));

    expect(plan.categorias).toEqual([{ codigo: 'B301', nombre: 'Agua' }]);
  });

  it('no toca la línea ni la descripción cuando la celda viene vacía', () => {
    const plan = planificarCategorias(leerCsv('codigo;subcategoria;linea;productos\nB301;Agua;;'));

    expect(plan.categorias).toEqual([{ codigo: 'B301', nombre: 'Agua' }]);
  });

  it('pasa el código a mayúsculas: c801 y C801 son el mismo código', () => {
    const plan = planificarCategorias(leerCsv('codigo;subcategoria\nc801;Cereales\nC801;Arroz'));

    expect(plan.categorias).toEqual([{ codigo: 'C801', nombre: 'Cereales' }]);
    expect(plan.rechazadas).toEqual([
      { linea: 3, motivo: 'El código C801 ya aparece en la línea 2.' },
    ]);
  });

  it('manda al reporte un código con espacios en medio', () => {
    const plan = planificarCategorias(leerCsv('codigo;subcategoria\nC 801;Cereales'));

    expect(plan.categorias).toEqual([]);
    expect(plan.rechazadas).toEqual([
      {
        linea: 2,
        motivo: 'El código del Banco va sin espacios y no puede pasar de 20 caracteres.',
      },
    ]);
  });

  it('falla entera si falta la columna de código o la de subcategoría', () => {
    expect(() => planificarCategorias(leerCsv('linea;productos\nAseo;Jabón'))).toThrow(
      ArchivoDeCodigosInvalido,
    );
  });

  it('manda al reporte, con su número de línea, las filas sin código o sin subcategoría', () => {
    const plan = planificarCategorias(
      leerCsv(
        `${CABECERA}\nB3;Bebidas;;Agua;Agua\nB3;Bebidas;B302;;Gaseosa\nB3;Bebidas;B303;Bebidas alcohólicas;Cerveza`,
      ),
    );

    expect(plan.categorias.map((c) => c.codigo)).toEqual(['B303']);
    expect(plan.rechazadas).toEqual([
      { linea: 2, motivo: 'Sin código.' },
      { linea: 3, motivo: 'Sin subcategoría.' },
    ]);
  });

  it('reporta la línea real aunque el archivo tenga líneas en blanco', () => {
    const plan = planificarCategorias(leerCsv('codigo;subcategoria\n\n\nA1;'));

    expect(plan.rechazadas).toEqual([{ linea: 4, motivo: 'Sin subcategoría.' }]);
  });

  it('manda al reporte un código repetido en el archivo y conserva la primera aparición', () => {
    const plan = planificarCategorias(
      leerCsv(`${CABECERA}\nB3;Bebidas;B301;Agua;Agua\nB3;Bebidas;B301;Agua;Agua con gas`),
    );

    expect(plan.categorias).toHaveLength(1);
    expect(plan.rechazadas).toEqual([
      { linea: 3, motivo: 'El código B301 ya aparece en la línea 2.' },
    ]);
  });

  it('manda al reporte una fila con un salto de línea en una celda, que se tragó las siguientes', () => {
    // La comilla de «"TV 32» se cierra en la última fila: E002 y E003 quedan
    // dentro de los productos de E001.
    const plan = planificarCategorias(
      leerCsv(
        'codigo;subcategoria;productos\nE001;Electro;"TV 32\nE002;Radio;x\nE003;Nevera;Neveras 10 y mas"',
      ),
    );

    expect(plan.categorias).toEqual([]);
    expect(plan.rechazadas).toEqual([
      {
        linea: 2,
        motivo: 'La fila trae un salto de línea dentro de una celda; revisa las comillas.',
      },
    ]);
  });

  it('manda al reporte el salto de línea aunque caiga en linea_codigo, que no se guarda', () => {
    // La comilla abre en la primera columna de E001 y cierra en la de E003:
    // E001 y E002 quedan dentro de linea_codigo y E003 pasaría como si nada.
    const plan = planificarCategorias(
      leerCsv(
        `${CABECERA}\n"E0;Electro;E001;TV;x\nE0;Electro;E002;Radio;y\nE0";Electro;E003;Nevera;z`,
      ),
    );

    expect(plan.categorias).toEqual([]);
    expect(plan.rechazadas).toEqual([
      {
        linea: 2,
        motivo: 'La fila trae un salto de línea dentro de una celda; revisa las comillas.',
      },
    ]);
  });

  it('falla entera si la cabecera trae un salto de línea dentro de una celda', () => {
    // La comilla de «"productos» se cierra en la fila de E002: E001 y E002
    // quedan dentro de la cabecera.
    expect(() =>
      planificarCategorias(
        leerCsv('codigo;subcategoria;"productos\nE001;Electro;x\nE002;Radio;y"\nE003;Nevera;z'),
      ),
    ).toThrow('La primera fila trae un salto de línea dentro de una celda; revisa las comillas.');
  });

  it('manda al reporte los valores más largos que su columna', () => {
    const plan = planificarCategorias(
      leerCsv(
        `codigo;subcategoria;linea\n${'C'.repeat(21)};Cereales;\nC801;${'n'.repeat(101)};\nC802;Cereales;${'l'.repeat(101)}`,
      ),
    );

    expect(plan.categorias).toEqual([]);
    expect(plan.rechazadas.map((r) => r.motivo)).toEqual([
      'El código del Banco va sin espacios y no puede pasar de 20 caracteres.',
      'La subcategoría pasa de 100 caracteres.',
      'La línea pasa de 100 caracteres.',
    ]);
  });

  it('lee sin rechazos la hoja de códigos del Banco', () => {
    const aqui = resolve(fileURLToPath(new URL('.', import.meta.url)));
    const hoja = readFileSync(resolve(aqui, '../../../../prisma/datos/codigos-banco.csv'), 'utf8');

    const plan = planificarCategorias(leerCsv(hoja));

    expect(plan.rechazadas).toEqual([]);
    expect(plan.categorias).toHaveLength(54);
    expect(plan.categorias.find((c) => c.codigo === 'C801')).toMatchObject({
      nombre: 'Cereales',
      linea: 'Cereales, raíces, tubérculos, plátanos y derivados',
    });
  });
});

describe('ImportacionCatalogoService', () => {
  let repositorio: RepositorioEnMemoria;
  let servicio: ImportacionCatalogoService;
  const archivo = `${CABECERA}\nB3;Bebidas;B301;Agua;Agua\nB3;Bebidas;;Sin código;x`;

  beforeEach(() => {
    repositorio = new RepositorioEnMemoria();
    servicio = new ImportacionCatalogoService(repositorio);
  });

  it('guarda las categorías válidas y reporta las rechazadas', async () => {
    const reporte = await servicio.importar(archivo);

    expect(reporte).toMatchObject({
      creadas: 1,
      actualizadas: 0,
      sinCambios: 0,
      rechazadas: [{ linea: 3, motivo: 'Sin código.' }],
    });
  });

  it('correrla dos veces no duplica: la segunda deja todo sin cambios', async () => {
    await servicio.importar(archivo);

    const segunda = await servicio.importar(archivo);

    expect(segunda).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 1 });
    expect(repositorio.categorias.size).toBe(1);
  });

  it('lee el archivo en bytes cuando viene en UTF-8', async () => {
    const reporte = await servicio.importar(new TextEncoder().encode(archivo));

    expect(reporte).toMatchObject({ creadas: 1 });
    expect(repositorio.categorias.get('B301')).toMatchObject({ nombre: 'Agua' });
  });

  it('rechaza un archivo que no está en UTF-8 sin guardar nada', async () => {
    // «Tubérculos» como lo guarda Excel en Windows-1252: la é es el byte 0xE9.
    const cabecera = new TextEncoder().encode('codigo;subcategoria\nC806;Tub');
    const windows1252 = Uint8Array.from([...cabecera, 0xe9, ...new TextEncoder().encode('rculos')]);

    await expect(servicio.importar(windows1252)).rejects.toThrow(/no está en UTF-8/);
    expect(repositorio.categorias.size).toBe(0);
  });

  it('lista los productos que siguen sin código para que la coordinación los asigne', async () => {
    repositorio.productosPendientes = ['Detergente'];

    const reporte = await servicio.importar(archivo);

    expect(reporte.productosSinCodigo).toEqual(['Detergente']);
  });

  it('no guarda nada si falla la consulta de productos sin código', async () => {
    repositorio.productosSinCodigo = () => Promise.reject(new Error('Se cayó la base.'));

    await expect(servicio.importar(archivo)).rejects.toThrow('Se cayó la base.');
    expect(repositorio.categorias.size).toBe(0);
  });
});
