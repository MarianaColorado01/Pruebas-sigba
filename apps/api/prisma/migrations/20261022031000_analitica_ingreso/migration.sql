-- SBA-50 · Modelo de lectura de ingresos, alimentado por eventos (ADR-09).
--
-- Una fila por lote recibido, escrita por el consumidor `analitica.ingresos`
-- desde RecepcionConfirmada. PrecioActualizado completa el valor de las que
-- llegaron sin precio. El reporte de ingresos (RF-M3-08) suma estas filas y
-- nunca lee tablas de inventario.

CREATE TABLE "analitica"."ingreso" (
    "banco_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "recepcion_id" UUID NOT NULL,
    -- Primer día del mes de la recepción, con el día en Colombia.
    "mes" DATE NOT NULL,
    "donante_id" UUID NOT NULL,
    "origen" TEXT NOT NULL,
    "bodega_id" UUID NOT NULL,
    "categoria_id" UUID NOT NULL,
    "referencia_id" UUID NOT NULL,
    "cantidad" DECIMAL(10, 3) NOT NULL,
    "kilos" DECIMAL(20, 6) NOT NULL,
    -- Los dos en NULL: valoración pendiente, nunca cero (ADR-13).
    "valor_unitario" DECIMAL(14, 2),
    "importe" DECIMAL(24, 5),
    CONSTRAINT "ingreso_pkey" PRIMARY KEY ("banco_id", "lote_id"),
    CONSTRAINT "ingreso_mes_check" CHECK ("mes" = date_trunc('month', "mes")::date),
    CONSTRAINT "ingreso_cantidad_check" CHECK ("cantidad" > 0 AND "kilos" > 0),
    CONSTRAINT "ingreso_valoracion_check" CHECK (("valor_unitario" IS NULL) = ("importe" IS NULL))
);

CREATE INDEX "ingreso_banco_mes_idx" ON "analitica"."ingreso" ("banco_id", "mes");

ALTER TABLE "analitica"."ingreso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "analitica"."ingreso" FORCE ROW LEVEL SECURITY;

CREATE POLICY ingreso_banco ON "analitica"."ingreso"
    USING ("banco_id" = NULLIF(current_setting('app.banco_id', true), '')::uuid)
    WITH CHECK ("banco_id" = NULLIF(current_setting('app.banco_id', true), '')::uuid);

REVOKE ALL ON TABLE "analitica"."ingreso" FROM PUBLIC;

SELECT "core"."verificar_politicas_rls"();

-- Los privilegios de sigba_app van en prisma/roles/rol-de-api.sql.
