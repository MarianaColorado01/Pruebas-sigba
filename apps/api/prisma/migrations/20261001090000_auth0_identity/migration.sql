-- SBA-8 · identidad OIDC global; conserva los datos de contacto existentes.
ALTER TABLE "plataforma"."usuario"
    DROP CONSTRAINT IF EXISTS "usuario_auth0_sub_key",
    ADD COLUMN IF NOT EXISTS "emisor" VARCHAR(500);

UPDATE "plataforma"."usuario"
SET "emisor" = 'https://legacy-auth0-issuer.invalid/'
WHERE "emisor" IS NULL;

ALTER TABLE "plataforma"."usuario"
    ALTER COLUMN "emisor" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "usuario_emisor_auth0_sub_key"
    ON "plataforma"."usuario" ("emisor", "auth0_sub");

DO $create_identity_role$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigba_identity_lookup') THEN
        CREATE ROLE sigba_identity_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$create_identity_role$;
GRANT USAGE ON SCHEMA plataforma TO sigba_identity_lookup;
GRANT SELECT ON "plataforma"."usuario" TO sigba_identity_lookup;

ALTER TABLE "plataforma"."usuario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plataforma"."usuario" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_identity_lookup ON "plataforma"."usuario";
CREATE POLICY usuario_identity_lookup ON "plataforma"."usuario"
    FOR SELECT TO sigba_identity_lookup
    USING (true);

-- Con FORCE RLS el dueño de la tabla también pasa por las políticas, y en Neon
-- no es superusuario. Sin esta política la conexión administrativa no podría
-- dar de alta usuarios. sigba_app no es el dueño: no le aplica.
DROP POLICY IF EXISTS usuario_administracion ON "plataforma"."usuario";
CREATE POLICY usuario_administracion ON "plataforma"."usuario"
    FOR ALL TO CURRENT_USER
    USING (true)
    WITH CHECK (true);

CREATE OR REPLACE FUNCTION "plataforma"."resolver_usuario_auth0"(
    p_emisor TEXT,
    p_auth0_sub TEXT
)
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, plataforma
AS $function$
    SELECT id
    FROM plataforma.usuario
    WHERE emisor = p_emisor
      AND auth0_sub = p_auth0_sub
      AND activo
    LIMIT 1
$function$;

-- Fuera de un superusuario (Neon), cambiar el dueño exige ser miembro del rol
-- nuevo y que este tenga CREATE en el schema. Se conceden solo para el cambio.
GRANT CREATE ON SCHEMA plataforma TO sigba_identity_lookup;
GRANT sigba_identity_lookup TO CURRENT_USER;
ALTER FUNCTION "plataforma"."resolver_usuario_auth0"(TEXT, TEXT)
    OWNER TO sigba_identity_lookup;
REVOKE sigba_identity_lookup FROM CURRENT_USER;
REVOKE CREATE ON SCHEMA plataforma FROM sigba_identity_lookup;
REVOKE ALL ON FUNCTION "plataforma"."resolver_usuario_auth0"(TEXT, TEXT) FROM PUBLIC;

-- El GRANT EXECUTE a sigba_app va en prisma/roles/rol-de-api.sql.

SELECT "core"."verificar_politicas_rls"();
