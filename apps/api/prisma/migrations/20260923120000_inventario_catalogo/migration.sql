-- =========================================================================
-- Catálogo del inventario: categoría, producto y referencia
-- SBA-11 · ADR-05 · ADR-07
-- =========================================================================

-- 1. Tablas

-- Una categoría es un código del Banco (C801, G103), que agrupa productos en
-- cualquier presentación; la línea (Cereales, Grasas) agrupa códigos. Mientras
-- codigo sea NULL, los productos de la categoría están pendientes de código.
CREATE TABLE "inventario"."categoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "codigo" VARCHAR(20),
    "nombre" VARCHAR(100) NOT NULL,
    "linea" VARCHAR(100),
    "descripcion" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" VARCHAR(100),
    "actualizado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "categoria_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventario"."producto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" VARCHAR(100),
    "actualizado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "producto_pkey" PRIMARY KEY ("id")
);

-- Producto más presentación, sin marca ni SKU: arroz Diana 500 g y arroz D1
-- 500 g son la misma referencia. El código del Banco lo hereda de la
-- categoría de su producto.
CREATE TABLE "inventario"."referencia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "producto_id" UUID NOT NULL,
    "presentacion" VARCHAR(100) NOT NULL,
    "equivalencia_kg" DECIMAL(10,3) NOT NULL,
    "creada_desde_celular" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" VARCHAR(100),
    "actualizado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "referencia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referencia_equivalencia_kg_positiva" CHECK ("equivalencia_kg" > 0)
);

-- 2. Índices

-- (banco_id, id) existe para las FK compuestas de abajo.
CREATE UNIQUE INDEX "categoria_banco_id_id_key" ON "inventario"."categoria"("banco_id", "id");
-- El nombre se repite en la hoja del Banco (cuatro «Otros alimentos»); el
-- código no. Postgres no compara NULL con NULL, así que varias categorías
-- pueden estar sin código a la vez.
CREATE UNIQUE INDEX "categoria_banco_id_codigo_key" ON "inventario"."categoria"("banco_id", "codigo");

CREATE UNIQUE INDEX "producto_banco_id_id_key" ON "inventario"."producto"("banco_id", "id");
CREATE UNIQUE INDEX "producto_banco_id_nombre_key" ON "inventario"."producto"("banco_id", "nombre");

-- Una marca nueva no crea otra referencia: la clave es producto y presentación.
CREATE UNIQUE INDEX "referencia_banco_id_producto_id_presentacion_key" ON "inventario"."referencia"("banco_id", "producto_id", "presentacion");

-- 3. Llaves foráneas
-- Compuestas con banco_id. Postgres comprueba una FK sin aplicar RLS, así que
-- una FK simple dejaría colgar un producto del banco A de una categoría del
-- banco B.

ALTER TABLE "inventario"."producto" ADD CONSTRAINT "producto_banco_id_categoria_id_fkey" FOREIGN KEY ("banco_id", "categoria_id") REFERENCES "inventario"."categoria"("banco_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventario"."referencia" ADD CONSTRAINT "referencia_banco_id_producto_id_fkey" FOREIGN KEY ("banco_id", "producto_id") REFERENCES "inventario"."producto"("banco_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Row Level Security · ADR-07

ALTER TABLE "inventario"."categoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."categoria" FORCE ROW LEVEL SECURITY;

CREATE POLICY categoria_banco_isolation ON "inventario"."categoria"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."producto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."producto" FORCE ROW LEVEL SECURITY;

CREATE POLICY producto_banco_isolation ON "inventario"."producto"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."referencia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."referencia" FORCE ROW LEVEL SECURITY;

CREATE POLICY referencia_banco_isolation ON "inventario"."referencia"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 5. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
