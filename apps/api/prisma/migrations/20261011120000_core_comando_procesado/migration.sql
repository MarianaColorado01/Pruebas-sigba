-- SBA-69 · Idempotencia común de comandos (Arquitectura 6.1, ADR-08).
--
-- Una fila por comando de negocio ya procesado: clave (banco_id, comando_id),
-- hash de la carga con su versión y el resultado como referencia a la entidad
-- creada. La carga no se guarda, para que no entren datos personales a core
-- (Arquitectura 8.6).

CREATE TABLE "core"."comando_procesado" (
    "banco_id" UUID NOT NULL,
    "comando_id" UUID NOT NULL,
    "carga_hash_version" SMALLINT NOT NULL,
    "carga_hash" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "comando_procesado_pkey" PRIMARY KEY ("banco_id", "comando_id"),
    CONSTRAINT "comando_procesado_carga_hash_check" CHECK ("carga_hash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "core"."comando_procesado" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."comando_procesado" FORCE ROW LEVEL SECURITY;

-- Append-only también para el dueño, como core.auditoria: un comando
-- procesado no cambia de resultado. Los límites son los mismos que allá.
CREATE FUNCTION "core"."rechazar_cambio_de_comando_procesado"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'core.comando_procesado es append-only: % no está permitido', TG_OP;
END;
$$;

CREATE TRIGGER "comando_procesado_sin_update_ni_delete"
    BEFORE UPDATE OR DELETE ON "core"."comando_procesado"
    FOR EACH ROW EXECUTE FUNCTION "core"."rechazar_cambio_de_comando_procesado"();

CREATE TRIGGER "comando_procesado_sin_truncate"
    BEFORE TRUNCATE ON "core"."comando_procesado"
    FOR EACH STATEMENT EXECUTE FUNCTION "core"."rechazar_cambio_de_comando_procesado"();

-- Sin TO: bajo FORCE la cumple también el dueño, que lee aquí la fila previa
-- desde core.reclamar_comando.
CREATE POLICY comando_procesado_banco_select ON "core"."comando_procesado"
    FOR SELECT
    USING (
        "banco_id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- Reserva el comando en la transacción del llamador. El banco sale del
-- contexto de la transacción, nunca de un argumento.
--
-- Si otra transacción ya insertó la misma clave sin confirmar, el INSERT
-- espera a que termine: si confirma, esta toma la rama del conflicto y lee su
-- fila; si revierte, esta inserta. Así dos reenvíos simultáneos no escriben
-- dos veces. Supone READ COMMITTED, el nivel por defecto.
--
-- Devuelve la fila guardada y `nuevo`: true si esta llamada la insertó.
CREATE FUNCTION "core"."reclamar_comando"(
    p_comando_id UUID,
    p_carga_hash_version SMALLINT,
    p_carga_hash TEXT,
    p_entidad TEXT,
    p_entidad_id UUID
)
RETURNS TABLE (
    nuevo BOOLEAN,
    carga_hash_version SMALLINT,
    carga_hash TEXT,
    entidad TEXT,
    entidad_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    contexto_banco UUID := NULLIF(current_setting('app.banco_id', true), '')::uuid;
BEGIN
    IF contexto_banco IS NULL THEN
        RAISE EXCEPTION 'Falta el contexto de banco para reclamar el comando';
    END IF;

    RETURN QUERY
        WITH insertada AS (
            INSERT INTO core.comando_procesado AS c (
                banco_id, comando_id, carga_hash_version, carga_hash, entidad, entidad_id
            ) VALUES (
                contexto_banco, p_comando_id, p_carga_hash_version, p_carga_hash,
                p_entidad, p_entidad_id
            )
            ON CONFLICT (banco_id, comando_id) DO NOTHING
            RETURNING c.carga_hash_version, c.carga_hash, c.entidad, c.entidad_id
        )
        SELECT true, i.carga_hash_version, i.carga_hash, i.entidad, i.entidad_id
        FROM insertada i;

    IF FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT false, c.carga_hash_version, c.carga_hash, c.entidad, c.entidad_id
        FROM core.comando_procesado c
        WHERE c.banco_id = contexto_banco
          AND c.comando_id = p_comando_id;
END;
$$;

-- El dueño solo inserta a través de la función y en el banco del contexto.
DO $$
DECLARE
    propietario TEXT := current_user;
BEGIN
    EXECUTE format(
        'CREATE POLICY comando_procesado_definer_insert ON core.comando_procesado FOR INSERT TO %I
         WITH CHECK (current_user = %L AND banco_id = NULLIF(current_setting(''app.banco_id'', true), '''')::uuid)',
        propietario,
        propietario
    );
END;
$$;

REVOKE ALL ON TABLE "core"."comando_procesado" FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."reclamar_comando"(UUID, SMALLINT, TEXT, TEXT, UUID) FROM PUBLIC;

-- Los privilegios de sigba_app van en prisma/roles/rol-de-api.sql.
