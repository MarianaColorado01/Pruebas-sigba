-- =========================================================================
-- Red ABACO, bancos y bodegas
-- SBA-19 · ADR-07 · docs/arquitectura/plataforma-sba-19.md (D7, D10, D11, D12)
-- =========================================================================

-- 1. Red ABACO (D12)
-- La única red. Id fijo para que la semilla y las pruebas la nombren sin
-- buscarla. La aplicación no crea ni edita redes.
INSERT INTO "plataforma"."red" ("id", "nombre")
VALUES ('00000000-0000-4000-8000-00000000abac', 'ABACO')
ON CONFLICT ("id") DO NOTHING;

-- 2. Banco (D11)
-- El código ya es único (banco_codigo_key). En mayúsculas y sin espacios, el
-- UNIQUE basta para que 'bap' y 'BAP' no convivan.
ALTER TABLE "plataforma"."banco"
    ADD CONSTRAINT "banco_codigo_en_mayusculas"
    CHECK ("codigo" <> '' AND "codigo" = upper(btrim("codigo")));

ALTER TABLE "plataforma"."banco"
    ADD CONSTRAINT "banco_nombre_sin_espacios_sobrantes"
    CHECK ("nombre" <> '' AND "nombre" = btrim("nombre"));

-- 3. Quién escribe bancos
-- Solo super_admin crea y edita bancos (D11). La API decide por rol, y la base
-- lo vuelve a comprobar: el usuario de app.usuario_id tiene que tener la
-- asignación activa de super_admin. Así un repositorio que escriba un banco
-- con el contexto de un admin_banco falla en vez de pasar.
--
-- La función lee usuario_rol, que tiene FORCE RLS y cuyas políticas solo dejan
-- ver filas del banco del contexto, y la de super_admin no tiene banco. Por eso
-- su dueño es un rol propio que solo ve las asignaciones de red (banco_id
-- NULL), con el mismo patrón que resolver_usuario_auth0.
DO $crear_rol$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sigba_super_admin_lookup') THEN
        CREATE ROLE sigba_super_admin_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$crear_rol$;
GRANT USAGE ON SCHEMA plataforma TO sigba_super_admin_lookup;
GRANT SELECT ON "plataforma"."usuario_rol", "plataforma"."rol" TO sigba_super_admin_lookup;

CREATE POLICY usuario_rol_super_admin_lookup ON "plataforma"."usuario_rol"
    FOR SELECT TO sigba_super_admin_lookup
    USING ("banco_id" IS NULL);

-- app.usuario_id se compara como texto, como en usuario_rol_propias: los
-- comandos ponen etiquetas que no son UUID.
CREATE FUNCTION "plataforma"."actua_como_super_admin"()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, plataforma
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM plataforma.usuario_rol ur
        JOIN plataforma.rol r ON r.id = ur.rol_id
        WHERE ur.usuario_id::text = NULLIF(current_setting('app.usuario_id', true), '')
          AND ur.activo
          AND r.codigo = 'super_admin'
    )
$function$;

GRANT CREATE ON SCHEMA plataforma TO sigba_super_admin_lookup;
GRANT sigba_super_admin_lookup TO CURRENT_USER;
ALTER FUNCTION "plataforma"."actua_como_super_admin"() OWNER TO sigba_super_admin_lookup;
REVOKE sigba_super_admin_lookup FROM CURRENT_USER;
REVOKE CREATE ON SCHEMA plataforma FROM sigba_super_admin_lookup;
REVOKE ALL ON FUNCTION "plataforma"."actua_como_super_admin"() FROM PUBLIC;
-- El GRANT EXECUTE a sigba_app va en prisma/roles/rol-de-api.sql.

-- banco es global: cualquiera lo lee (el guard lo cruza con las asignaciones).
-- Escribir exige super_admin y que app.banco_id sea el banco escrito (D7): la
-- auditoría de esa misma transacción queda en ese banco.
ALTER TABLE "plataforma"."banco" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plataforma"."banco" FORCE ROW LEVEL SECURITY;

CREATE POLICY banco_lectura ON "plataforma"."banco"
    FOR SELECT
    USING (true);

CREATE POLICY banco_alta ON "plataforma"."banco"
    FOR INSERT
    WITH CHECK (
        "id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND "plataforma"."actua_como_super_admin"()
    );

CREATE POLICY banco_edicion ON "plataforma"."banco"
    FOR UPDATE
    USING (
        "id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND "plataforma"."actua_como_super_admin"()
    )
    WITH CHECK (
        "id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND "plataforma"."actua_como_super_admin"()
    );

-- Con FORCE RLS el dueño también pasa por las políticas y en Neon no es
-- superusuario. La semilla y las migraciones escriben bancos con él.
CREATE POLICY banco_administracion ON "plataforma"."banco"
    FOR ALL TO CURRENT_USER
    USING (true)
    WITH CHECK (true);

-- SBA-61 registró banco como catálogo sin RLS; desde aquí la lleva.
UPDATE "core"."tabla_global"
SET "control" = 'rls',
    "razon" = 'Lectura abierta, sin datos personales. Solo super_admin escribe, con app.banco_id del banco escrito (D7, SBA-19).'
WHERE "esquema" = 'plataforma' AND "tabla" = 'banco';

-- 4. Bodega (D10)
-- Nombre de 1 a 80 caracteres sin espacios a los lados, único por banco sin
-- importar mayúsculas. Dirección opcional hasta 200.
--
-- Antes de endurecer, se normalizan las filas que ya existan para que la
-- migración no falle con datos previos: espacios recortados, nombre vacío
-- reemplazado, texto cortado al nuevo límite y, si dos bodegas de un banco
-- chocan por mayúsculas, la más reciente queda con un sufijo ' (2)', ' (3)'.
-- FORCE RLS dejaría a este UPDATE sin filas (no hay app.banco_id), así que se
-- suelta durante la normalización y se restituye al final.
ALTER TABLE "plataforma"."bodega" NO FORCE ROW LEVEL SECURITY;

UPDATE "plataforma"."bodega"
SET "nombre" = CASE
        WHEN btrim("nombre") = '' THEN 'Bodega ' || left("id"::text, 8)
        ELSE left(btrim("nombre"), 80)
    END,
    "direccion" = left("direccion", 200);

WITH repetidas AS (
    SELECT "id",
           row_number() OVER (
               PARTITION BY "banco_id", lower("nombre")
               ORDER BY "creado_en", "id"
           ) AS n
    FROM "plataforma"."bodega"
)
UPDATE "plataforma"."bodega" b
SET "nombre" = left(b."nombre", 80 - length(' (' || r.n || ')')) || ' (' || r.n || ')'
FROM repetidas r
WHERE b."id" = r."id" AND r.n > 1;

ALTER TABLE "plataforma"."bodega" FORCE ROW LEVEL SECURITY;

ALTER TABLE "plataforma"."bodega"
    ALTER COLUMN "nombre" TYPE VARCHAR(80),
    ALTER COLUMN "direccion" TYPE VARCHAR(200);

ALTER TABLE "plataforma"."bodega"
    ADD CONSTRAINT "bodega_nombre_sin_espacios_sobrantes"
    CHECK ("nombre" <> '' AND "nombre" = btrim("nombre"));

-- Prisma no expresa índices sobre expresiones.
CREATE UNIQUE INDEX "bodega_banco_id_nombre_key"
    ON "plataforma"."bodega" ("banco_id", lower("nombre"));

SELECT "core"."verificar_politicas_rls"();
