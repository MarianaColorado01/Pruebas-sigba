-- Auditoría append-only con aislamiento por banco (RNF-04, Arquitectura 8.6).

CREATE TABLE "core"."auditoria" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "ocurrido_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "actor_tipo" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_etiqueta" TEXT,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "resultado" TEXT NOT NULL DEFAULT 'ok',
    "finalidad" TEXT,
    "detalle" JSONB,
    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auditoria_actor_tipo_check" CHECK ("actor_tipo" IN ('usuario', 'sistema')),
    CONSTRAINT "auditoria_actor_check" CHECK (
        ("actor_tipo" = 'usuario' AND "actor_id" IS NOT NULL)
        OR ("actor_tipo" = 'sistema' AND "actor_etiqueta" IS NOT NULL)
    ),
    CONSTRAINT "auditoria_accion_check" CHECK ("accion" IN ('crear', 'actualizar', 'eliminar', 'leer'))
);

CREATE INDEX "auditoria_banco_ocurrido_idx"
    ON "core"."auditoria" ("banco_id", "ocurrido_en");

ALTER TABLE "core"."auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."auditoria" FORCE ROW LEVEL SECURITY;

-- Append-only también para el dueño: los GRANT no lo frenan, el trigger sí.
-- No resiste a quien puede hacer DDL (ALTER TABLE ... DISABLE TRIGGER) ni a un
-- superusuario con session_replication_role = replica; por eso la API no debe
-- conectarse como dueño. TRUNCATE no dispara triggers por fila, por eso lleva
-- uno por sentencia.
CREATE FUNCTION "core"."rechazar_cambio_de_auditoria"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'core.auditoria es append-only: % no está permitido', TG_OP;
END;
$$;

CREATE TRIGGER "auditoria_sin_update_ni_delete"
    BEFORE UPDATE OR DELETE ON "core"."auditoria"
    FOR EACH ROW EXECUTE FUNCTION "core"."rechazar_cambio_de_auditoria"();

CREATE TRIGGER "auditoria_sin_truncate"
    BEFORE TRUNCATE ON "core"."auditoria"
    FOR EACH STATEMENT EXECUTE FUNCTION "core"."rechazar_cambio_de_auditoria"();

CREATE POLICY auditoria_banco_select ON "core"."auditoria"
    FOR SELECT
    USING (
        "banco_id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

CREATE OR REPLACE FUNCTION "core"."registrar_auditoria"(
    p_accion TEXT,
    p_entidad TEXT,
    p_entidad_id TEXT,
    p_finalidad TEXT DEFAULT NULL,
    p_detalle JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
DECLARE
    contexto_banco TEXT := NULLIF(current_setting('app.banco_id', true), '');
    -- app.usuario_id es el UUID de quien hace la petición. Un comando sin
    -- usuario, como importar-codigos, deja su etiqueta en app.actor.
    contexto_actor TEXT := COALESCE(
        NULLIF(current_setting('app.usuario_id', true), ''),
        NULLIF(current_setting('app.actor', true), '')
    );
    nueva_id UUID;
BEGIN
    IF contexto_banco IS NULL OR contexto_actor IS NULL THEN
        RAISE EXCEPTION 'Falta el contexto de banco o actor para registrar auditoría';
    END IF;

    IF contexto_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        INSERT INTO core.auditoria (
            banco_id, actor_tipo, actor_id, accion, entidad, entidad_id, finalidad, detalle
        ) VALUES (
            contexto_banco::uuid, 'usuario', contexto_actor::uuid, p_accion, p_entidad,
            p_entidad_id, p_finalidad, p_detalle
        )
        RETURNING id INTO nueva_id;
    ELSE
        INSERT INTO core.auditoria (
            banco_id, actor_tipo, actor_etiqueta, accion, entidad, entidad_id, finalidad, detalle
        ) VALUES (
            contexto_banco::uuid, 'sistema', contexto_actor, p_accion, p_entidad,
            p_entidad_id, p_finalidad, p_detalle
        )
        RETURNING id INTO nueva_id;
    END IF;

    RETURN nueva_id;
END;
$$;

DO $$
DECLARE
    propietario TEXT := current_user;
BEGIN
    EXECUTE format(
        'CREATE POLICY auditoria_definer_insert ON core.auditoria FOR INSERT TO %I
         WITH CHECK (current_user = %L AND banco_id = NULLIF(current_setting(''app.banco_id'', true), '''')::uuid)',
        propietario,
        propietario
    );
END;
$$;

REVOKE ALL ON TABLE "core"."auditoria" FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."registrar_auditoria"(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
