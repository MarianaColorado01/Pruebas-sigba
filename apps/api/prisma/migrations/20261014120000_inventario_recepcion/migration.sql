-- =========================================================================
-- Recepción manual: recepción, lote, detalle y libro de movimientos
-- SBA-24 · ADR-07 · ADR-08 · ADR-13
-- =========================================================================
--
-- La idempotencia por comando no vive aquí: la lleva core.comando_procesado
-- (SBA-69). Los privilegios de sigba_app están en prisma/roles/rol-de-api.sql.

-- 1. Tipos

CREATE TYPE "inventario"."origen_recepcion" AS ENUM ('propia', 'abaco', 'plataforma');
CREATE TYPE "inventario"."novedad_recepcion" AS ENUM ('roto', 'reempacado', 'no_apto');
-- Sin precio vigente aprobado la fila queda pendiente, nunca en cero (ADR-13).
-- El valor aprobado llega con el maestro de precios (SBA-39).
CREATE TYPE "inventario"."estado_valoracion" AS ENUM ('pendiente');
CREATE TYPE "inventario"."tipo_movimiento" AS ENUM ('entrada');

-- 2. Tablas

-- bodega_id no lleva FK: bodega vive en plataforma y SBA-34 no cruza schemas.
CREATE TABLE "inventario"."recepcion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "donante_id" UUID NOT NULL,
    "origen" "inventario"."origen_recepcion" NOT NULL,
    "bodega_id" UUID NOT NULL,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recepcion_pkey" PRIMARY KEY ("id")
);

-- Lo recibido de una referencia en una recepción. El saldo se llevará por
-- banco, bodega y lote (Arquitectura 8.3); codigo es el lote impreso en el
-- empaque, si lo trae. vencimiento es nulo cuando el producto no trae fecha:
-- aseo, menaje y otros no alimentos llegan sin ella, y obligarla haría que
-- bodega inventara una o dejara la recepción en el cuaderno.
CREATE TABLE "inventario"."lote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "recepcion_id" UUID NOT NULL,
    "referencia_id" UUID NOT NULL,
    "codigo" VARCHAR(50),
    "vencimiento" DATE,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lote_pkey" PRIMARY KEY ("id")
);

-- Libro append-only (ADR-08): sin actualizado_en, y el trigger de abajo
-- rechaza UPDATE, DELETE y TRUNCATE. El id lo genera el celular, uno por
-- detalle; comando_id es el del comando que lo escribió. La llave incluye
-- banco_id: un id que ya usó otro banco no choca, y el 409 no le confirma a
-- nadie que ese id existe en otro banco.
CREATE TABLE "inventario"."movimiento" (
    "id" UUID NOT NULL,
    "banco_id" UUID NOT NULL,
    "comando_id" UUID NOT NULL,
    "tipo" "inventario"."tipo_movimiento" NOT NULL,
    "referencia_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "bodega_id" UUID NOT NULL,
    "cantidad" DECIMAL(10,3) NOT NULL,
    "kilos" DECIMAL(20,6) NOT NULL,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "movimiento_pkey" PRIMARY KEY ("banco_id", "id"),
    CONSTRAINT "movimiento_cantidad_positiva" CHECK ("cantidad" > 0),
    CONSTRAINT "movimiento_kilos_positivos" CHECK ("kilos" > 0)
);

-- Lo que la recepción sabe de cada fila y el libro no: su posición, la
-- novedad y la valoración. Referencia, lote, cantidad y kilos se leen del
-- movimiento, así no hay dos copias que puedan diferir. valoracion es la
-- única columna que cambiará después (SBA-39).
CREATE TABLE "inventario"."recepcion_detalle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "recepcion_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "novedad" "inventario"."novedad_recepcion",
    "valoracion" "inventario"."estado_valoracion" NOT NULL DEFAULT 'pendiente',
    "creado_por" VARCHAR(100) NOT NULL,
    "actualizado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recepcion_detalle_pkey" PRIMARY KEY ("id")
);

-- 3. Índices

-- (banco_id, id) existe para las FK compuestas de abajo; donante y referencia
-- no lo tenían porque nada colgaba de ellos.
CREATE UNIQUE INDEX "donante_banco_id_id_key" ON "inventario"."donante"("banco_id", "id");
CREATE UNIQUE INDEX "referencia_banco_id_id_key" ON "inventario"."referencia"("banco_id", "id");
CREATE UNIQUE INDEX "recepcion_banco_id_id_key" ON "inventario"."recepcion"("banco_id", "id");

-- El movimiento apunta al lote con su referencia, para que no pueda nombrar
-- una referencia distinta a la del lote.
CREATE UNIQUE INDEX "lote_banco_id_id_referencia_id_key" ON "inventario"."lote"("banco_id", "id", "referencia_id");

CREATE INDEX "movimiento_banco_id_comando_id_idx" ON "inventario"."movimiento"("banco_id", "comando_id");

CREATE UNIQUE INDEX "recepcion_detalle_banco_id_movimiento_id_key" ON "inventario"."recepcion_detalle"("banco_id", "movimiento_id");
CREATE UNIQUE INDEX "recepcion_detalle_recepcion_id_orden_key" ON "inventario"."recepcion_detalle"("recepcion_id", "orden");

-- 4. Llaves foráneas
-- Compuestas con banco_id, como en el catálogo: Postgres comprueba una FK sin
-- aplicar RLS, y una simple dejaría a una recepción del banco A nombrar un
-- donante o una referencia del banco B. ON UPDATE RESTRICT: estas filas no
-- cambian de clave, y una cascada chocaría con los triggers de la sección 5.

ALTER TABLE "inventario"."recepcion" ADD CONSTRAINT "recepcion_banco_id_donante_id_fkey" FOREIGN KEY ("banco_id", "donante_id") REFERENCES "inventario"."donante"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."lote" ADD CONSTRAINT "lote_banco_id_recepcion_id_fkey" FOREIGN KEY ("banco_id", "recepcion_id") REFERENCES "inventario"."recepcion"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."lote" ADD CONSTRAINT "lote_banco_id_referencia_id_fkey" FOREIGN KEY ("banco_id", "referencia_id") REFERENCES "inventario"."referencia"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."movimiento" ADD CONSTRAINT "movimiento_banco_id_lote_id_referencia_id_fkey" FOREIGN KEY ("banco_id", "lote_id", "referencia_id") REFERENCES "inventario"."lote"("banco_id", "id", "referencia_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."recepcion_detalle" ADD CONSTRAINT "recepcion_detalle_banco_id_recepcion_id_fkey" FOREIGN KEY ("banco_id", "recepcion_id") REFERENCES "inventario"."recepcion"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."recepcion_detalle" ADD CONSTRAINT "recepcion_detalle_banco_id_movimiento_id_fkey" FOREIGN KEY ("banco_id", "movimiento_id") REFERENCES "inventario"."movimiento"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5. Filas que no se editan · ADR-08
-- Triggers, que frenan también al dueño; los GRANT de sigba_app no bastan.
-- TRUNCATE no dispara triggers por fila, por eso lleva uno por sentencia.

CREATE FUNCTION "inventario"."rechazar_cambio_en_recepcion"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventario.% es append-only (ADR-08): no admite %', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER "recepcion_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."recepcion"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "recepcion_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."recepcion"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

CREATE TRIGGER "lote_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."lote"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "lote_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."lote"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

CREATE TRIGGER "movimiento_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."movimiento"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "movimiento_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."movimiento"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

-- En el detalle solo cambia la valoración, con quién y cuándo la cambió.
CREATE FUNCTION "inventario"."rechazar_cambio_en_detalle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- IF anidado: en DELETE y TRUNCATE no hay NEW que comparar.
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.banco_id, NEW.recepcion_id, NEW.orden, NEW.movimiento_id,
            NEW.novedad, NEW.creado_por, NEW.creado_en)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.banco_id, OLD.recepcion_id, OLD.orden, OLD.movimiento_id,
            OLD.novedad, OLD.creado_por, OLD.creado_en)
        THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'inventario.recepcion_detalle solo admite cambiar la valoración (ADR-08): no admite %', TG_OP;
END;
$$;

CREATE TRIGGER "recepcion_detalle_solo_valoracion"
    BEFORE UPDATE OR DELETE ON "inventario"."recepcion_detalle"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_detalle"();
CREATE TRIGGER "recepcion_detalle_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."recepcion_detalle"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_detalle"();

-- 6. Row Level Security · ADR-07

ALTER TABLE "inventario"."recepcion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."recepcion" FORCE ROW LEVEL SECURITY;

CREATE POLICY recepcion_banco_isolation ON "inventario"."recepcion"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."lote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."lote" FORCE ROW LEVEL SECURITY;

CREATE POLICY lote_banco_isolation ON "inventario"."lote"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."movimiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."movimiento" FORCE ROW LEVEL SECURITY;

CREATE POLICY movimiento_banco_isolation ON "inventario"."movimiento"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."recepcion_detalle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."recepcion_detalle" FORCE ROW LEVEL SECURITY;

CREATE POLICY recepcion_detalle_banco_isolation ON "inventario"."recepcion_detalle"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 7. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
