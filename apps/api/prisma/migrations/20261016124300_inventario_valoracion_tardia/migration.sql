-- =========================================================================
-- Valoración tardía: lo que vale cada entrada que llegó sin precio
-- SBA-43 · ADR-07 · ADR-08 · ADR-13
-- =========================================================================
--
-- Al aprobar un precio, los detalles de recepción pendientes de esa
-- referencia cuya fecha de recepción cae en la vigencia quedan con precio.
-- El movimiento no se toca: la valoración es una fila aparte que lo nombra.
-- Los privilegios de sigba_app están en prisma/roles/rol-de-api.sql.

-- 1. Tipo

-- Postgres no deja usar un valor que se agregó en la misma transacción: nada
-- de esta migración nombra 'con_precio'. Es el mismo nombre que devuelve
-- GET /referencias/:id/precio-vigente (SBA-39).
ALTER TYPE "inventario"."estado_valoracion" ADD VALUE 'con_precio';

-- 2. Tabla

-- Una fila por movimiento valorado, append-only como el libro (ADR-08).
-- valor_unitario es el valor del precio, que un trigger ya no deja cambiar;
-- importe es cantidad × valor_unitario, exacto: Decimal(10,3) por
-- Decimal(14,2) cabe en Decimal(24,5).
CREATE TABLE "inventario"."valoracion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "movimiento_id" UUID NOT NULL,
    "precio_id" UUID NOT NULL,
    "valor_unitario" DECIMAL(14,2) NOT NULL,
    "importe" DECIMAL(24,5) NOT NULL,
    "creado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "valoracion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "valoracion_valor_unitario_positivo" CHECK ("valor_unitario" > 0),
    CONSTRAINT "valoracion_importe_positivo" CHECK ("importe" > 0)
);

-- 3. Índices

-- Un movimiento se valora una sola vez.
CREATE UNIQUE INDEX "valoracion_banco_id_movimiento_id_key" ON "inventario"."valoracion"("banco_id", "movimiento_id");
CREATE INDEX "valoracion_banco_id_precio_id_idx" ON "inventario"."valoracion"("banco_id", "precio_id");

-- Para la FK compuesta de abajo.
CREATE UNIQUE INDEX "precio_banco_id_id_key" ON "inventario"."precio"("banco_id", "id");

-- 4. Llaves foráneas
-- Compuestas con banco_id: Postgres comprueba una FK sin aplicar RLS, y una
-- simple dejaría al banco A valorar un movimiento del banco B o valorar con
-- un precio del banco B.

ALTER TABLE "inventario"."valoracion" ADD CONSTRAINT "valoracion_banco_id_movimiento_id_fkey" FOREIGN KEY ("banco_id", "movimiento_id") REFERENCES "inventario"."movimiento"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "inventario"."valoracion" ADD CONSTRAINT "valoracion_banco_id_precio_id_fkey" FOREIGN KEY ("banco_id", "precio_id") REFERENCES "inventario"."precio"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5. Filas que no se editan · ADR-08

CREATE TRIGGER "valoracion_append_only"
    BEFORE UPDATE OR DELETE ON "inventario"."valoracion"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();
CREATE TRIGGER "valoracion_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."valoracion"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."rechazar_cambio_en_recepcion"();

-- En el detalle la valoración sale de pendiente y no vuelve: un detalle con
-- precio tiene su fila en inventario.valoracion, que no se borra. Lo demás
-- sigue como lo dejó 20261014120000.
CREATE OR REPLACE FUNCTION "inventario"."rechazar_cambio_en_detalle"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- IF anidado: en DELETE y TRUNCATE no hay NEW que comparar.
    IF TG_OP = 'UPDATE' THEN
        IF OLD.valoracion <> 'pendiente' AND NEW.valoracion IS DISTINCT FROM OLD.valoracion THEN
            RAISE EXCEPTION 'inventario.recepcion_detalle: una valoración con precio no vuelve a pendiente (ADR-08)';
        END IF;
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

-- 6. Row Level Security · ADR-07

ALTER TABLE "inventario"."valoracion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."valoracion" FORCE ROW LEVEL SECURITY;

CREATE POLICY valoracion_banco_isolation ON "inventario"."valoracion"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 7. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
