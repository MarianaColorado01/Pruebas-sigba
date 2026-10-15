-- SBA-20 · Parámetros por banco con vigencia (Arquitectura 8.7).

ALTER TABLE plataforma.parametro_banco
    RENAME COLUMN vigente_desde TO fecha_inicio;
ALTER TABLE plataforma.parametro_banco
    RENAME COLUMN vigente_hasta TO fecha_fin;

ALTER TABLE plataforma.parametro_banco
    ALTER COLUMN fecha_inicio DROP DEFAULT,
    ALTER COLUMN fecha_inicio TYPE date
        USING (fecha_inicio AT TIME ZONE 'America/Bogota')::date,
    ALTER COLUMN fecha_fin TYPE date
        USING (fecha_fin AT TIME ZONE 'America/Bogota')::date,
    ALTER COLUMN clave TYPE text,
    ALTER COLUMN valor TYPE jsonb USING CASE
        WHEN pg_input_is_valid(valor, 'jsonb') THEN valor::jsonb
        ELSE to_jsonb(valor)
    END;

ALTER TABLE plataforma.parametro_banco
    ADD COLUMN version integer;

WITH versiones AS (
    SELECT id, row_number() OVER (
        PARTITION BY banco_id, clave
        ORDER BY fecha_inicio, id
    )::integer AS version
    FROM plataforma.parametro_banco
)
UPDATE plataforma.parametro_banco AS parametro
SET version = versiones.version
FROM versiones
WHERE parametro.id = versiones.id;

ALTER TABLE plataforma.parametro_banco
    ALTER COLUMN version SET NOT NULL,
    DROP COLUMN actualizado_en,
    DROP CONSTRAINT parametro_banco_banco_id_fkey,
    ADD CONSTRAINT parametro_banco_banco_id_fkey
        FOREIGN KEY (banco_id) REFERENCES plataforma.banco(id)
        ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM plataforma.parametro_banco
        GROUP BY banco_id, clave, fecha_inicio
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'parametro_banco contiene versiones de la misma clave en el mismo día; revise los datos antes de migrar';
    END IF;
END;
$$;

WITH siguientes AS (
    SELECT id,
           lead(fecha_inicio) OVER (
               PARTITION BY banco_id, clave
               ORDER BY version
           ) AS siguiente_inicio
    FROM plataforma.parametro_banco
)
UPDATE plataforma.parametro_banco AS parametro
SET fecha_fin = siguientes.siguiente_inicio - 1
FROM siguientes
WHERE parametro.id = siguientes.id
  AND siguientes.siguiente_inicio IS NOT NULL
  AND (parametro.fecha_fin IS NULL OR parametro.fecha_fin >= siguientes.siguiente_inicio);

DROP INDEX IF EXISTS plataforma.parametro_banco_banco_id_clave_vigente_desde_idx;

CREATE UNIQUE INDEX parametro_banco_banco_id_clave_version_key
    ON plataforma.parametro_banco (banco_id, clave, version);
CREATE INDEX parametro_banco_banco_id_clave_fecha_inicio_idx
    ON plataforma.parametro_banco (banco_id, clave, fecha_inicio);

ALTER TABLE plataforma.parametro_banco
    ADD CONSTRAINT parametro_banco_fecha_fin_check
    CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio),
    ADD CONSTRAINT parametro_banco_version_positiva_check
    CHECK (version > 0);

CREATE UNIQUE INDEX parametro_banco_una_version_abierta_key
    ON plataforma.parametro_banco (banco_id, clave)
    WHERE fecha_fin IS NULL;

-- Vigencias [fecha_inicio, fecha_fin] sin solapamiento por banco y clave.
-- fecha_fin NULL es un rango abierto hacia adelante.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE plataforma.parametro_banco
    ADD CONSTRAINT parametro_banco_sin_solapamiento
    EXCLUDE USING gist (
        banco_id WITH =,
        clave WITH =,
        daterange(fecha_inicio, fecha_fin, '[]') WITH &&
    );

-- Una versión es inmutable salvo dos excepciones: cerrar fecha_fin una vez, y
-- corregir el valor de una versión cuya vigencia aún no empezó (fecha_inicio
-- posterior a hoy en Bogotá). Una versión vigente o pasada se corrige creando
-- una versión nueva hacia adelante.
CREATE OR REPLACE FUNCTION plataforma.restringir_cambio_parametro_banco()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    inmutables_iguales boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'plataforma.parametro_banco no permite DELETE';
    END IF;

    inmutables_iguales :=
        ROW(NEW.id, NEW.banco_id, NEW.clave, NEW.version, NEW.fecha_inicio, NEW.creado_por, NEW.creado_en)
        IS NOT DISTINCT FROM
        ROW(OLD.id, OLD.banco_id, OLD.clave, OLD.version, OLD.fecha_inicio, OLD.creado_por, OLD.creado_en);

    IF inmutables_iguales
       AND OLD.fecha_fin IS NULL
       AND NEW.fecha_fin IS NOT NULL
       AND NEW.valor IS NOT DISTINCT FROM OLD.valor
    THEN
        RETURN NEW;
    END IF;

    IF inmutables_iguales
       AND NEW.fecha_fin IS NOT DISTINCT FROM OLD.fecha_fin
       AND NEW.valor IS DISTINCT FROM OLD.valor
       AND OLD.fecha_inicio > (now() AT TIME ZONE 'America/Bogota')::date
    THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'plataforma.parametro_banco es inmutable; solo se permite cerrar fecha_fin una vez o corregir el valor de una versión futura';
END;
$$;

CREATE TRIGGER parametro_banco_solo_cierre
    BEFORE UPDATE OR DELETE ON plataforma.parametro_banco
    FOR EACH ROW EXECUTE FUNCTION plataforma.restringir_cambio_parametro_banco();

CREATE FUNCTION plataforma.restringir_truncate_parametro_banco()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'plataforma.parametro_banco no permite TRUNCATE';
END;
$$;

CREATE TRIGGER parametro_banco_sin_truncate
    BEFORE TRUNCATE ON plataforma.parametro_banco
    FOR EACH STATEMENT EXECUTE FUNCTION plataforma.restringir_truncate_parametro_banco();

ALTER TABLE plataforma.parametro_banco ENABLE ROW LEVEL SECURITY;
ALTER TABLE plataforma.parametro_banco FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parametro_banco_isolation ON plataforma.parametro_banco;
CREATE POLICY parametro_banco_isolation ON plataforma.parametro_banco
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

REVOKE ALL ON TABLE plataforma.parametro_banco FROM PUBLIC;

SELECT core.verificar_politicas_rls();
