-- =========================================================================
-- Directorio de donantes
-- SBA-25 · ADR-07
-- =========================================================================

-- 1. Tabla

CREATE TYPE "inventario"."tipo_donante" AS ENUM ('empresa', 'parroquia', 'particular', 'otro_banco');

CREATE TABLE "inventario"."donante" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "tipo" "inventario"."tipo_donante" NOT NULL,
    "contacto" VARCHAR(200),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" VARCHAR(100),
    "actualizado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "donante_pkey" PRIMARY KEY ("id")
);

-- El filtro por tipo es la consulta de la recepción y del reporte de ingresos.
CREATE INDEX "donante_banco_id_tipo_idx" ON "inventario"."donante"("banco_id", "tipo");

-- 2. Row Level Security · ADR-07

ALTER TABLE "inventario"."donante" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."donante" FORCE ROW LEVEL SECURITY;

CREATE POLICY donante_banco_isolation ON "inventario"."donante"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 3. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
