-- =========================================================================
-- Libro de movimientos completo y saldo derivado por lote
-- SBA-35 · ADR-07 · ADR-08 · Arquitectura 8.3
-- =========================================================================
--
-- El libro (inventario.movimiento) ya existe desde la recepción (SBA-24). Aquí
-- recibe los demás tipos y el saldo que se deriva de él: una fila por banco,
-- bodega y lote que solo cambia cuando entra un movimiento.

-- 1. Tipos de movimiento
-- La cantidad lleva signo: lo que entra suma y lo que sale resta, y el saldo
-- es la suma del libro. Un traslado son dos filas del mismo comando: resta en
-- la bodega de origen y suma en la de destino.

ALTER TYPE "inventario"."tipo_movimiento" ADD VALUE 'salida';
ALTER TYPE "inventario"."tipo_movimiento" ADD VALUE 'traslado';
ALTER TYPE "inventario"."tipo_movimiento" ADD VALUE 'baja';
ALTER TYPE "inventario"."tipo_movimiento" ADD VALUE 'ajuste';

-- tipo::text y no el enum: Postgres no deja usar un valor que se agregó en la
-- misma transacción.
ALTER TABLE "inventario"."movimiento"
    DROP CONSTRAINT "movimiento_cantidad_positiva",
    DROP CONSTRAINT "movimiento_kilos_positivos",
    ADD CONSTRAINT "movimiento_signo_segun_tipo" CHECK (
        "cantidad" <> 0
        AND sign("kilos") = sign("cantidad")
        AND CASE "tipo"::text
            WHEN 'entrada' THEN "cantidad" > 0
            WHEN 'salida' THEN "cantidad" < 0
            WHEN 'baja' THEN "cantidad" < 0
            -- ajuste y traslado van en los dos sentidos.
            ELSE true
        END
    );

-- 2. Equivalencia congelada en el lote
-- El saldo se lleva en unidades de la presentación del lote: cinco bultos de
-- 50 kg y quince bolsas de 1 kg son dos lotes de dos referencias y nunca se
-- suman. Los kilos salen de las unidades por la equivalencia, y esa
-- equivalencia se congela al recibir: si el catálogo la corrige después, el
-- lote sigue pesando lo que pesó y una salida no puede dejar los kilos del
-- saldo descuadrados con sus unidades.
--
-- Los lotes que ya existen la toman de su movimiento de entrada, que se
-- calculó con la equivalencia de ese momento; la de la referencia solo si no
-- lo hay. El lote es append-only y con FORCE: se apagan el trigger y el FORCE
-- mientras se llena.

ALTER TABLE "inventario"."lote" ADD COLUMN "equivalencia_kg" DECIMAL(10,3);

ALTER TABLE "inventario"."lote" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."movimiento" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."referencia" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."lote" DISABLE TRIGGER "lote_append_only";

UPDATE "inventario"."lote" l
SET "equivalencia_kg" = COALESCE(
    (SELECT m."kilos" / m."cantidad"
     FROM "inventario"."movimiento" m
     WHERE m."banco_id" = l."banco_id" AND m."lote_id" = l."id" AND m."tipo" = 'entrada'
     ORDER BY m."creado_en"
     LIMIT 1),
    (SELECT r."equivalencia_kg"
     FROM "inventario"."referencia" r
     WHERE r."banco_id" = l."banco_id" AND r."id" = l."referencia_id")
);

ALTER TABLE "inventario"."lote" ENABLE TRIGGER "lote_append_only";
ALTER TABLE "inventario"."referencia" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."movimiento" FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."lote" FORCE ROW LEVEL SECURITY;

ALTER TABLE "inventario"."lote"
    ALTER COLUMN "equivalencia_kg" SET NOT NULL,
    ADD CONSTRAINT "lote_equivalencia_positiva" CHECK ("equivalencia_kg" > 0);

-- 3. Saldo
-- Más ancho que el movimiento: es la suma de muchos.

CREATE TABLE "inventario"."saldo" (
    "banco_id" UUID NOT NULL,
    "bodega_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "referencia_id" UUID NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "kilos" DECIMAL(24,6) NOT NULL,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saldo_pkey" PRIMARY KEY ("banco_id", "bodega_id", "lote_id"),
    -- La última defensa contra vender lo que no hay: dos salidas a la vez
    -- sobre el mismo lote se ordenan por el bloqueo de la fila y la segunda
    -- choca aquí.
    CONSTRAINT "saldo_cantidad_no_negativa" CHECK ("cantidad" >= 0),
    CONSTRAINT "saldo_kilos_no_negativos" CHECK ("kilos" >= 0)
);

-- La consulta de stock (SBA-36) filtra por referencia.
CREATE INDEX "saldo_banco_id_referencia_id_idx" ON "inventario"."saldo"("banco_id", "referencia_id");

-- Compuesta con banco_id y con la referencia del lote, como el movimiento.
ALTER TABLE "inventario"."saldo" ADD CONSTRAINT "saldo_banco_id_lote_id_referencia_id_fkey" FOREIGN KEY ("banco_id", "lote_id", "referencia_id") REFERENCES "inventario"."lote"("banco_id", "id", "referencia_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 4. Saldo de lo que ya está en el libro
-- El dueño se salta RLS solo sin FORCE: se quita mientras se lee el libro.
-- Si no, la suma vería cero filas y el saldo nacería vacío.

ALTER TABLE "inventario"."movimiento" NO FORCE ROW LEVEL SECURITY;

INSERT INTO "inventario"."saldo" ("banco_id", "bodega_id", "lote_id", "referencia_id", "cantidad", "kilos")
SELECT "banco_id", "bodega_id", "lote_id", "referencia_id", sum("cantidad"), sum("kilos")
FROM "inventario"."movimiento"
GROUP BY "banco_id", "bodega_id", "lote_id", "referencia_id";

ALTER TABLE "inventario"."movimiento" FORCE ROW LEVEL SECURITY;

-- 5. Cada movimiento suma a su saldo, en la misma transacción
-- Un trigger y no el servicio: así ninguna escritura del libro deja el saldo
-- atrás, venga del flujo que venga (Arquitectura 8.3). El UPDATE bloquea la
-- fila del lote hasta el commit. SECURITY DEFINER porque sigba_app solo lee
-- el saldo: escribirlo pasa por aquí.
--
-- UPDATE y después INSERT, no un upsert: INSERT ... ON CONFLICT revisa los
-- CHECK sobre la fila propuesta antes de ver el conflicto, así que una salida
-- chocaría con el saldo no negativo aunque el lote tuviera de sobra. Si no hay
-- fila, el INSERT de una salida choca con el CHECK, que es lo correcto: en esa
-- bodega no hay nada de ese lote. El ON CONFLICT cubre dos entradas que
-- estrenan el mismo lote a la vez.
--
-- Antes de sumar exige que los kilos sean las unidades por la equivalencia
-- congelada del lote: así el saldo nunca descuadra kilos y unidades, venga el
-- movimiento del flujo que venga.

CREATE FUNCTION "inventario"."sumar_al_saldo"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, inventario, pg_temp
AS $$
DECLARE
    equivalencia numeric;
BEGIN
    SELECT equivalencia_kg INTO equivalencia
    FROM inventario.lote
    WHERE banco_id = NEW.banco_id AND id = NEW.lote_id;

    IF NEW.kilos <> NEW.cantidad * equivalencia THEN
        RAISE EXCEPTION 'movimiento_kilos_segun_lote: % unidades del lote % pesan % kg, no %',
            NEW.cantidad, NEW.lote_id, NEW.cantidad * equivalencia, NEW.kilos
            USING ERRCODE = 'check_violation';
    END IF;

    UPDATE inventario.saldo
    SET cantidad = cantidad + NEW.cantidad,
        kilos = kilos + NEW.kilos,
        actualizado_en = clock_timestamp()
    WHERE banco_id = NEW.banco_id AND bodega_id = NEW.bodega_id AND lote_id = NEW.lote_id;

    IF NOT FOUND THEN
        INSERT INTO inventario.saldo AS s (banco_id, bodega_id, lote_id, referencia_id, cantidad, kilos)
        VALUES (NEW.banco_id, NEW.bodega_id, NEW.lote_id, NEW.referencia_id, NEW.cantidad, NEW.kilos)
        ON CONFLICT (banco_id, bodega_id, lote_id) DO UPDATE
            SET cantidad = s.cantidad + EXCLUDED.cantidad,
                kilos = s.kilos + EXCLUDED.kilos,
                actualizado_en = clock_timestamp();
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION "inventario"."sumar_al_saldo"() FROM PUBLIC;

CREATE TRIGGER "movimiento_suma_al_saldo"
    AFTER INSERT ON "inventario"."movimiento"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."sumar_al_saldo"();

-- 6. Row Level Security · ADR-07

ALTER TABLE "inventario"."saldo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."saldo" FORCE ROW LEVEL SECURITY;

CREATE POLICY saldo_banco_isolation ON "inventario"."saldo"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 7. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
