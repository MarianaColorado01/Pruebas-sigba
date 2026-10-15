-- =========================================================================
-- Maestro de precios: precio por referencia genérica, con piso y techo
-- SBA-39 · ADR-07 · ADR-08 · ADR-13
-- =========================================================================
--
-- La idempotencia por comando la lleva core.comando_procesado (SBA-69). Los
-- privilegios de sigba_app están en prisma/roles/rol-de-api.sql.

-- 1. Extensión y tipos

-- Para que la exclusión de la sección 3 compare banco_id y referencia_id
-- con = dentro de un índice GiST. Es una extensión de confianza: no exige
-- superusuario.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "inventario"."fuente_precio" AS ENUM ('remision', 'sipsa', 'catalogo', 'manual');
-- «Vencido» no se guarda: es un aprobado cuyo vigente_hasta ya pasó, y
-- guardarlo pediría un proceso que lo marque cada noche.
CREATE TYPE "inventario"."estado_precio" AS ENUM ('propuesto', 'aprobado');

-- 2. Tabla

-- Un precio en pesos por unidad de la presentación de la referencia, sin
-- marca (ADR-13). Nunca cero: sin precio aprobado la valoración queda
-- pendiente. Aprobar uno nuevo cierra la vigencia del anterior y no lo borra.
CREATE TABLE "inventario"."precio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "referencia_id" UUID NOT NULL,
    "valor" DECIMAL(14,2) NOT NULL,
    "piso" DECIMAL(14,2) NOT NULL,
    "techo" DECIMAL(14,2) NOT NULL,
    "fuente" "inventario"."fuente_precio" NOT NULL,
    "evidencia" TEXT NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "vigente_hasta" DATE,
    "estado" "inventario"."estado_precio" NOT NULL DEFAULT 'propuesto',
    "motivo_fuera_de_banda" TEXT,
    "aprobado_por" VARCHAR(100),
    "aprobado_en" TIMESTAMPTZ,
    "creado_por" VARCHAR(100) NOT NULL,
    "actualizado_por" VARCHAR(100) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "precio_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "precio_valor_positivo" CHECK ("valor" > 0),
    CONSTRAINT "precio_banda_valida" CHECK ("piso" > 0 AND "piso" <= "techo"),
    CONSTRAINT "precio_evidencia_no_vacia" CHECK (btrim("evidencia") <> ''),
    CONSTRAINT "precio_vigencia_valida" CHECK ("vigente_hasta" IS NULL OR "vigente_hasta" >= "vigente_desde"),
    -- Quién y cuándo aprobó existe si y solo si está aprobado.
    CONSTRAINT "precio_aprobacion_completa" CHECK (
        ("estado" = 'propuesto' AND "aprobado_por" IS NULL AND "aprobado_en" IS NULL)
        OR ("estado" = 'aprobado' AND "aprobado_por" IS NOT NULL AND "aprobado_en" IS NOT NULL)
    ),
    -- Criterio 2 de SBA-39: aprobar fuera de la banda exige motivo. El
    -- servicio da el mensaje; esto lo garantiza aunque alguien se lo salte.
    CONSTRAINT "precio_motivo_fuera_de_banda" CHECK (
        "estado" <> 'aprobado'
        OR "valor" BETWEEN "piso" AND "techo"
        OR btrim(coalesce("motivo_fuera_de_banda", '')) <> ''
    )
);

-- 3. Índices

-- Una sola versión vigente por referencia y día (ADR-13): dos aprobados de
-- la misma referencia no pueden cruzar sus vigencias. Los propuestos no
-- cuentan. Con vigente_hasta nulo el rango queda abierto.
ALTER TABLE "inventario"."precio" ADD CONSTRAINT "precio_aprobados_sin_cruce"
    EXCLUDE USING gist (
        "banco_id" WITH =,
        "referencia_id" WITH =,
        daterange("vigente_desde", "vigente_hasta", '[]') WITH &&
    ) WHERE ("estado" = 'aprobado');

CREATE INDEX "precio_banco_id_referencia_id_vigente_desde_idx"
    ON "inventario"."precio"("banco_id", "referencia_id", "vigente_desde");

-- 4. Llave foránea
-- Compuesta con banco_id: Postgres comprueba una FK sin aplicar RLS, y una
-- simple dejaría al banco A ponerle precio a una referencia del banco B. El
-- índice referencia_banco_id_id_key lo creó la recepción (20261014120000).

ALTER TABLE "inventario"."precio" ADD CONSTRAINT "precio_banco_id_referencia_id_fkey" FOREIGN KEY ("banco_id", "referencia_id") REFERENCES "inventario"."referencia"("banco_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- 5. Qué cambia de un precio · ADR-08
-- Dos cambios y nada más: aprobar un propuesto, con quién, cuándo y el
-- motivo; y acortar la vigencia de un aprobado cuando otro lo reemplaza.
-- Valor, banda, fuente y evidencia no cambian nunca: corregir es proponer
-- otro. Un trigger frena también al dueño; los GRANT de sigba_app no bastan.

CREATE FUNCTION "inventario"."limitar_cambio_en_precio"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- IF anidado: en DELETE y TRUNCATE no hay NEW que comparar.
    IF TG_OP = 'UPDATE' THEN
        IF (NEW.id, NEW.banco_id, NEW.referencia_id, NEW.valor, NEW.piso, NEW.techo,
            NEW.fuente, NEW.evidencia, NEW.vigente_desde, NEW.creado_por, NEW.creado_en)
           IS DISTINCT FROM
           (OLD.id, OLD.banco_id, OLD.referencia_id, OLD.valor, OLD.piso, OLD.techo,
            OLD.fuente, OLD.evidencia, OLD.vigente_desde, OLD.creado_por, OLD.creado_en)
        THEN
            RAISE EXCEPTION 'inventario.precio no admite cambiar valor, banda, fuente, evidencia ni inicio de vigencia (ADR-08): se propone otro precio';
        END IF;

        -- Aprobar: la vigencia queda como se propuso.
        IF OLD.estado = 'propuesto' AND NEW.estado = 'aprobado'
           AND NEW.vigente_hasta IS NOT DISTINCT FROM OLD.vigente_hasta
        THEN
            RETURN NEW;
        END IF;

        -- Cerrar un aprobado: solo se acorta vigente_hasta.
        IF OLD.estado = 'aprobado' AND NEW.estado = 'aprobado'
           AND (NEW.aprobado_por, NEW.aprobado_en, NEW.motivo_fuera_de_banda)
               IS NOT DISTINCT FROM (OLD.aprobado_por, OLD.aprobado_en, OLD.motivo_fuera_de_banda)
           AND NEW.vigente_hasta IS NOT NULL
           AND (OLD.vigente_hasta IS NULL OR NEW.vigente_hasta < OLD.vigente_hasta)
        THEN
            RETURN NEW;
        END IF;
    END IF;
    RAISE EXCEPTION 'inventario.precio solo admite aprobar un propuesto o acortar la vigencia de un aprobado (ADR-08): no admite este %', TG_OP;
END;
$$;

CREATE TRIGGER "precio_cambios_limitados"
    BEFORE UPDATE OR DELETE ON "inventario"."precio"
    FOR EACH ROW EXECUTE FUNCTION "inventario"."limitar_cambio_en_precio"();
CREATE TRIGGER "precio_sin_truncate"
    BEFORE TRUNCATE ON "inventario"."precio"
    FOR EACH STATEMENT EXECUTE FUNCTION "inventario"."limitar_cambio_en_precio"();

-- 6. Row Level Security · ADR-07

ALTER TABLE "inventario"."precio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventario"."precio" FORCE ROW LEVEL SECURITY;

CREATE POLICY precio_banco_isolation ON "inventario"."precio"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- 7. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
