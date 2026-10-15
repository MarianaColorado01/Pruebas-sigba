-- =========================================================================
-- Bajas y ajustes de inventario con su motivo
-- SBA-42 · ADR-07 · ADR-08
-- =========================================================================
--
-- La baja y el ajuste son movimientos del libro (tipos 'baja' y 'ajuste',
-- SBA-35). El motivo no cabe en inventario.movimiento, que es genérico: va en
-- una tabla propia que apunta a su movimiento, como recepcion_detalle.
--
-- Una tabla por tipo y no una para los dos: la baja trae un motivo de una
-- lista y el ajuste un texto libre obligatorio. En una sola tabla las dos
-- columnas serían nulas y un CHECK tendría que emparejarlas con el tipo; así
-- cada una es NOT NULL y la base no admite una baja sin motivo tipificado ni
-- un ajuste sin explicación.

-- 1. Tipos

CREATE TYPE "inventario"."motivo_baja" AS ENUM ('vencido', 'no_apto', 'roto', 'perdida');

-- 2. Tablas
-- La llave es la del movimiento: una baja o un ajuste es un solo movimiento.
-- Cantidad, lote, bodega y fecha se leen de él, así no hay dos copias.

CREATE TABLE "inventario"."baja" (
    "banco_id" UUID NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "motivo" "inventario"."motivo_baja" NOT NULL,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "baja_pkey" PRIMARY KEY ("banco_id", "movimiento_id")
);

CREATE TABLE "inventario"."ajuste" (
    "banco_id" UUID NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ajuste_pkey" PRIMARY KEY ("banco_id", "movimiento_id"),
    -- El servicio ya lo exige; esto cubre a quien escriba sin pasar por él.
    CONSTRAINT "ajuste_motivo_no_vacio" CHECK (btrim("motivo") <> '')
);

-- 3. Llaves foráneas
-- Compuestas con banco_id: Postgres comprueba una FK sin aplicar RLS.

ALTER TABLE "inventario"."baja" ADD CONSTRAINT "baja_banco_id_movimiento_id_fkey" FOREIGN KEY ("banco_id", "movimiento_id") REFERENCES "inventario"."movimiento"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."ajuste" ADD CONSTRAINT "ajuste_banco_id_movimiento_id_fkey" FOREIGN KEY ("banco_id", "movimiento_id") REFERENCES "inventario"."movimiento"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4. Filas que no se editan · ADR-08
-- La misma función que la recepción, el lote y el libro.

CREATE TRIGGER "baja_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."baja"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "baja_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."baja"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

CREATE TRIGGER "ajuste_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."ajuste"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "ajuste_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."ajuste"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

-- 5. Row Level Security · ADR-07

ALTER TABLE "inventario"."baja" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."baja" FORCE ROW LEVEL SECURITY;

CREATE POLICY baja_banco_isolation ON "inventario"."baja"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."ajuste" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."ajuste" FORCE ROW LEVEL SECURITY;

CREATE POLICY ajuste_banco_isolation ON "inventario"."ajuste"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 6. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
