/**
 * Semilla de desarrollo: un banco sintético con los códigos del Banco que
 * corresponden a las cinco agrupaciones del glosario (granos, dulces, aseo,
 * fruta y verdura, panadería), más el arroz con tres presentaciones (SBA-11).
 * La hoja completa, 54 códigos, la carga la importación de SBA-12. Siembra
 * también tipos de población sintéticos mientras Cáritas aprueba la lista
 * inicial (esquema de beneficiarios, 5.2): sin ellos no se puede dar de alta
 * una institución.
 *
 *   pnpm --filter @sigba/api exec prisma db seed
 *
 * Solo datos sintéticos (Arquitectura 7.1). Es idempotente: correrla dos
 * veces deja lo mismo. El banco cuelga de la red ABACO, que crea la migración
 * de SBA-19 con id fijo (D12 de docs/arquitectura/plataforma-sba-19.md).
 */
import { PrismaClient } from '@prisma/client';

const RED_ABACO = '00000000-0000-4000-8000-00000000abac';
const BANCO_ID = '00000000-0000-4000-8000-000000000002';

/**
 * Códigos de la hoja de aporte solidario del Banco, copiados tal cual. Fruta y
 * verdura son dos códigos en la hoja.
 */
const CATEGORIAS = [
  {
    // granos
    codigo: 'CA404',
    nombre: 'Leguminosas secas y mezclas vegetales',
    linea: 'Carnes, huevos, leguminosas secas, frutos secos y semillas',
    descripcion:
      'Arveja seca - Fríjol - Lenteja - Garbanzo - Mezclas vegetales (Bienestarina, Solidarina, Colombiarina) - Proteína de soya texturizada - Proteína vegetal soya',
  },
  {
    codigo: 'C801',
    nombre: 'Cereales',
    linea: 'Cereales, raíces, tubérculos, plátanos y derivados',
    descripcion: 'Arroz blanco - Arroz integral - Arroz sopero',
  },
  {
    // dulces
    codigo: 'AZ902',
    nombre: 'Dulces y postres p',
    linea: 'Azúcares',
    descripcion:
      'Chocolate con azúcar - Chocolatinas - Arequipe - Barras de cereal - Donas - Bocadillo - Cocada - Cocoa - Gelatina - Masmelos - Panelitas - Postre - Caramelos - Ciruelas pasas - Confites',
  },
  {
    // aseo
    codigo: 'A201',
    nombre: 'Hogar',
    linea: 'Aseo',
    descripcion:
      'Blanqueadores - Crema dental - Detergentes - Suavizantes - Utensilios para aseo hogar',
  },
  {
    // fruta
    codigo: 'FV501',
    nombre: 'Frutas',
    linea: 'Frutas y verduras',
    descripcion:
      'Granadilla - Manzana - Guayaba - Papaya - Piña - Naranja - Limón - Banano - Guanábana - Mango - Lulo - Mandarina - Maracuyá - Mora - Fresa - Anón - Arazá - Árbol del pan - Asaí - Babaco - Badea - Borojó - Breva - Cacao - Caimo - Carambolo - Cereza - Chamba - Chirimoya - Chontaduro - Chupas - Cidra - Ciruela - Ciruelo - Curuba - Dátil - Durazno - Feijoa - Granada - Guamo - Gulupa - Higo - Icaco - Kiwi - Lima - Madroño - Mamey - Mamoncillo - Mangostán - Marañón - Melón - Noni - Palmito - Papayuela - Pera - Piñuela - Pitahaya - Pomarrosa - Sandía - Tamarindo - Táparo - Tomate de árbol - Toronja - Uchuva - Uva - Zapote',
  },
  {
    // verdura
    codigo: 'FV502',
    nombre: 'Verduras',
    linea: 'Frutas y verduras',
    descripcion:
      'Tomate - Zanahoria - Cebolla todas las variedades - Brócoli - Pepino - Lechuga - Cilantro - Ajo - Remolacha - Ají - Apio - Arveja verde - Espinaca - Repollo - Tallos - Pimentón - Habichuela - Aceituna - Perejil - Coliflor - Acelga - Ahuyama o zapallo - Alcachofa - Alcaparras - Balú - Batata - Berenjena - Berro - Bore - Calabaza - Candia - Cardo - Champiñón - Chugua - Colinabo - Espárrago - Guascas - Guatila - Guisantes - Habas verdes - Ibia - Nabo - Palmito - Rábano - Repollitas - Ruibarbo',
  },
  {
    // panadería
    codigo: 'C803',
    nombre: 'Panadería',
    linea: 'Cereales, raíces, tubérculos, plátanos y derivados',
    descripcion: 'Panadería - Galletas en general - Brownie - Ponqué - Roscón - Torta',
  },
];

/** Tres referencias del mismo producto, las tres con el código C801. */
const PRESENTACIONES_DE_ARROZ = [
  { presentacion: '500 g', equivalenciaKg: '0.5' },
  { presentacion: '1 kg', equivalenciaKg: '1' },
  { presentacion: 'arroba', equivalenciaKg: '12.5' },
];

/** Lista sintética, los ejemplos de la sección 5.2 del esquema de beneficiarios. */
const TIPOS_DE_POBLACION = ['Familias', 'Adultos mayores', 'Habitantes de calle'];

const prisma = new PrismaClient();

async function sembrar(): Promise<void> {
  // El dueño de las tablas escribe bancos por la política banco_administracion.
  // `update` mueve a ABACO un banco sembrado antes con la red sintética.
  await prisma.banco.upsert({
    where: { id: BANCO_ID },
    update: { redId: RED_ABACO },
    create: { id: BANCO_ID, redId: RED_ABACO, nombre: 'Banco sintético', codigo: 'SINT' },
  });

  // El catálogo tiene FORCE RLS: sin contexto de banco, ni el dueño de las
  // tablas puede escribir.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.banco_id', ${BANCO_ID}, true)`;

    for (const categoria of CATEGORIAS) {
      await tx.categoria.upsert({
        where: { bancoId_codigo: { bancoId: BANCO_ID, codigo: categoria.codigo } },
        update: {},
        create: { bancoId: BANCO_ID, ...categoria, creadoPor: 'semilla' },
      });
    }

    const cereales = await tx.categoria.findUniqueOrThrow({
      where: { bancoId_codigo: { bancoId: BANCO_ID, codigo: 'C801' } },
    });
    const arroz = await tx.producto.upsert({
      where: { bancoId_nombre: { bancoId: BANCO_ID, nombre: 'Arroz' } },
      update: {},
      create: {
        bancoId: BANCO_ID,
        categoriaId: cereales.id,
        nombre: 'Arroz',
        creadoPor: 'semilla',
      },
    });

    for (const { presentacion, equivalenciaKg } of PRESENTACIONES_DE_ARROZ) {
      await tx.referencia.upsert({
        where: {
          bancoId_productoId_presentacion: {
            bancoId: BANCO_ID,
            productoId: arroz.id,
            presentacion,
          },
        },
        update: {},
        create: {
          bancoId: BANCO_ID,
          productoId: arroz.id,
          presentacion,
          equivalenciaKg,
          creadoPor: 'semilla',
        },
      });
    }

    // El UNIQUE es sobre lower(nombre), que Prisma no expresa: no hay upsert.
    for (const nombre of TIPOS_DE_POBLACION) {
      await tx.$executeRaw`
        INSERT INTO beneficiarios.tipo_poblacion (banco_id, nombre)
        VALUES (${BANCO_ID}::uuid, ${nombre})
        ON CONFLICT (banco_id, lower(nombre)) DO NOTHING`;
    }
  });
}

try {
  await sembrar();
} finally {
  await prisma.$disconnect();
}
