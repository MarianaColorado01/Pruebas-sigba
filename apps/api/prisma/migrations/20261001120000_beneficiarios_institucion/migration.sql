-- =========================================================================
-- Directorio de instituciones (migración A del esquema de beneficiarios)
-- SBA-26 · ADR-07 · docs/SBA-15/esquema_beneficiarios.md sección 5
-- =========================================================================

-- 1. Enums

CREATE TYPE "beneficiarios"."tipo_institucion" AS ENUM ('parroquia', 'comunidad_religiosa', 'fundacion');

CREATE TYPE "beneficiarios"."dia_semana" AS ENUM ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo');

-- 2. Tipos de población

CREATE TABLE "beneficiarios"."tipo_poblacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "tipo_poblacion_pkey" PRIMARY KEY ("id")
);

-- Destino de la FK compuesta de institucion (y, después, de beneficiario).
CREATE UNIQUE INDEX "tipo_poblacion_banco_id_id_key" ON "beneficiarios"."tipo_poblacion"("banco_id", "id");

-- Prisma no expresa índices sobre expresiones.
CREATE UNIQUE INDEX "tipo_poblacion_banco_id_nombre_key" ON "beneficiarios"."tipo_poblacion"("banco_id", lower("nombre"));

-- 3. Instituciones

CREATE TABLE "beneficiarios"."institucion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "tipo" "beneficiarios"."tipo_institucion" NOT NULL,
    "contacto_nombre" VARCHAR(200) NOT NULL,
    "contacto_telefono" VARCHAR(30),
    "contacto_correo" VARCHAR(200),
    "direccion" VARCHAR(500),
    "dia_recogida" "beneficiarios"."dia_semana",
    "tipo_poblacion_id" UUID NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "actualizado_por" VARCHAR(100),
    "actualizado_en" TIMESTAMPTZ,
    CONSTRAINT "institucion_pkey" PRIMARY KEY ("id"),
    -- Quién y cuándo van juntos o no va ninguno (SBA-26, criterio 2).
    CONSTRAINT "institucion_actualizado_completo"
        CHECK (("actualizado_por" IS NULL) = ("actualizado_en" IS NULL))
);

CREATE UNIQUE INDEX "institucion_banco_id_id_key" ON "beneficiarios"."institucion"("banco_id", "id");

CREATE UNIQUE INDEX "institucion_banco_id_nombre_key" ON "beneficiarios"."institucion"("banco_id", lower("nombre"));

-- El listado de destinatarios de M1 (SBA-33).
CREATE INDEX "institucion_banco_id_activa_idx" ON "beneficiarios"."institucion"("banco_id", "activa");

-- FK compuesta: PostgreSQL comprueba una FK sin aplicar RLS, así que una FK
-- simple dejaría colgar una institución del banco A de un tipo del banco B.
ALTER TABLE "beneficiarios"."institucion"
    ADD CONSTRAINT "institucion_banco_id_tipo_poblacion_id_fkey"
    FOREIGN KEY ("banco_id", "tipo_poblacion_id")
    REFERENCES "beneficiarios"."tipo_poblacion"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Row Level Security · ADR-07
-- Sin condición de institución: el portal restringe cada usuario a la suya en
-- una fase posterior (SBA-45).

ALTER TABLE "beneficiarios"."tipo_poblacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."tipo_poblacion" FORCE ROW LEVEL SECURITY;

CREATE POLICY tipo_poblacion_banco_isolation ON "beneficiarios"."tipo_poblacion"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "beneficiarios"."institucion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."institucion" FORCE ROW LEVEL SECURITY;

CREATE POLICY institucion_banco_isolation ON "beneficiarios"."institucion"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 5. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
