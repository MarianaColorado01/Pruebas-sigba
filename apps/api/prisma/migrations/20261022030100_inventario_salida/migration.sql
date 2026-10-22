-- =========================================================================
-- Salida a institución
-- SBA-38 · SBA-40 · ADR-07 · ADR-08 · ADR-13
-- =========================================================================
--
-- Una salida entrega a una institución lo de varios lotes de una bodega. Cada
-- detalle es un movimiento 'salida' del libro (SBA-35), que resta del saldo
-- con el bloqueo por lote y el CHECK no negativo. La salida guarda lo que el
-- libro no sabe: a quién se entregó, quién despachó y el porcentaje de aporte
-- solidario vigente ese día.
--
-- El valor comercial de cada detalle va en inventario.valoracion, la misma
-- tabla de la valoración de entradas (SBA-43): una fila por movimiento, con
-- el precio aprobado que la respalda. Sin precio vigente aprobado no hay fila
-- y el detalle queda pendiente; nunca en cero (ADR-13). El aporte es valor
-- comercial por porcentaje y se calcula al leer: los dos factores quedan
-- guardados y no cambian.

-- 1. Tipos

CREATE TYPE "inventario"."tipo_despachador" AS ENUM ('funcionario', 'voluntario');

-- 2. Tablas

CREATE TABLE "inventario"."salida" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    -- Sin FK: la institución vive en beneficiarios y la bodega en plataforma.
    -- Las valida su dueño antes de escribir (ADR-05, ADR-14).
    "institucion_id" UUID NOT NULL,
    "bodega_id" UUID NOT NULL,
    "despachador" VARCHAR(200) NOT NULL,
    "despachador_tipo" "inventario"."tipo_despachador" NOT NULL,
    -- Nulo si el banco no tenía aporte_solidario_pct vigente: el aporte queda
    -- pendiente, no en cero.
    "aporte_pct" DECIMAL(5,2),
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salida_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salida_despachador_no_vacio" CHECK (btrim("despachador") <> ''),
    CONSTRAINT "salida_aporte_pct_en_rango" CHECK ("aporte_pct" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "salida_banco_id_id_key" ON "inventario"."salida"("banco_id", "id");

-- La llave es la del movimiento: cada detalle es un solo movimiento. Lote,
-- referencia, cantidad y kilos se leen de él.
CREATE TABLE "inventario"."salida_detalle" (
    "banco_id" UUID NOT NULL,
    "salida_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salida_detalle_pkey" PRIMARY KEY ("banco_id", "movimiento_id")
);

CREATE UNIQUE INDEX "salida_detalle_salida_id_orden_key" ON "inventario"."salida_detalle"("salida_id", "orden");

-- 3. Llaves foráneas
-- Compuestas con banco_id: Postgres comprueba una FK sin aplicar RLS.

ALTER TABLE "inventario"."salida_detalle" ADD CONSTRAINT "salida_detalle_banco_id_salida_id_fkey" FOREIGN KEY ("banco_id", "salida_id") REFERENCES "inventario"."salida"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."salida_detalle" ADD CONSTRAINT "salida_detalle_banco_id_movimiento_id_fkey" FOREIGN KEY ("banco_id", "movimiento_id") REFERENCES "inventario"."movimiento"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4. Filas que no se editan · ADR-08

CREATE TRIGGER "salida_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."salida"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "salida_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."salida"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

CREATE TRIGGER "salida_detalle_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."salida_detalle"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "salida_detalle_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."salida_detalle"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

-- 5. Row Level Security · ADR-07

ALTER TABLE "inventario"."salida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."salida" FORCE ROW LEVEL SECURITY;

CREATE POLICY salida_banco_isolation ON "inventario"."salida"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

ALTER TABLE "inventario"."salida_detalle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."salida_detalle" FORCE ROW LEVEL SECURITY;

CREATE POLICY salida_detalle_banco_isolation ON "inventario"."salida_detalle"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 6. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
