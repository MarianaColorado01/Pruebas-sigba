-- SBA-30 · Eventos de dominio en la transacción que los produce (ADR-09).

CREATE TABLE "core"."outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "version" SMALLINT NOT NULL,
    "payload" JSONB NOT NULL,
    "ocurrido_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "publicado_en" TIMESTAMPTZ,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_tipo_check" CHECK (btrim("tipo") <> ''),
    CONSTRAINT "outbox_version_check" CHECK ("version" > 0),
    CONSTRAINT "outbox_payload_check" CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "outbox_intentos_check" CHECK ("intentos" >= 0)
);

CREATE INDEX "outbox_banco_ocurrido_idx"
    ON "core"."outbox" ("banco_id", "ocurrido_en", "id");

CREATE INDEX "outbox_pendiente_idx"
    ON "core"."outbox" ("banco_id", "ocurrido_en", "id")
    WHERE "publicado_en" IS NULL;

ALTER TABLE "core"."outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."outbox" FORCE ROW LEVEL SECURITY;

CREATE POLICY outbox_banco_select ON "core"."outbox"
    FOR SELECT
    USING (
        "banco_id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

CREATE OR REPLACE FUNCTION "core"."emitir_evento"(
    p_tipo TEXT,
    p_version SMALLINT,
    p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
DECLARE
    contexto_banco UUID := NULLIF(current_setting('app.banco_id', true), '')::uuid;
    nuevo_id UUID;
BEGIN
    IF contexto_banco IS NULL THEN
        RAISE EXCEPTION 'Falta el contexto de banco para emitir el evento';
    END IF;

    IF p_tipo IS NULL OR btrim(p_tipo) = '' OR p_version IS NULL OR p_version < 1 THEN
        RAISE EXCEPTION 'El tipo y la versión del evento son obligatorios';
    END IF;

    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'La carga del evento debe ser un objeto JSON';
    END IF;

    INSERT INTO core.outbox (banco_id, tipo, version, payload)
    VALUES (contexto_banco, p_tipo, p_version, p_payload)
    RETURNING id INTO nuevo_id;

    RETURN nuevo_id;
END;
$$;

DO $$
DECLARE
    propietario TEXT := current_user;
BEGIN
    EXECUTE format(
        'CREATE POLICY outbox_definer_insert ON core.outbox FOR INSERT TO %I
         WITH CHECK (current_user = %L AND banco_id = NULLIF(current_setting(''app.banco_id'', true), '''')::uuid)',
        propietario,
        propietario
    );
END;
$$;

REVOKE ALL ON TABLE "core"."outbox" FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."emitir_evento"(TEXT, SMALLINT, JSONB) FROM PUBLIC;

SELECT "core"."verificar_politicas_rls"();
