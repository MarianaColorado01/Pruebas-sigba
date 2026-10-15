-- =========================================================================
-- Políticas propias de las entidades globales: red, rol, banco y usuario
-- SBA-61 · ADR-07 · docs/arquitectura/plataforma-sba-19.md (D14)
-- =========================================================================

-- 1. red, rol y banco: catálogos sin RLS
-- No tienen banco_id ni datos personales. red es la red ABACO; rol, el
-- catálogo de Arquitectura 8.2; banco, el nombre y el código de cada banco,
-- que la API necesita para mostrar en qué banco actúa cada asignación. La API
-- los lee con GRANT SELECT y no les escribe sin una línea explícita en
-- prisma/roles/rol-de-api.sql. Lo que aísla los datos de cada banco es el
-- banco_id de las tablas operativas, no estas filas.

-- 2. usuario: cada quien ve su fila y la de quienes trabajan en su banco
-- Antes sigba_app no tenía política y leía cero filas: solo resolvía la
-- identidad por plataforma.resolver_usuario_auth0. Administrar usuarios exige
-- ver a las personas del banco, y solo a ellas (ADR-07).
--
-- Una persona con asignaciones en A y en B aparece para los dos bancos: es la
-- misma fila. Una que solo está en B no aparece en A. Las asignaciones
-- inactivas no cuentan: quitar el acceso (D15) también la saca de la lista.
--
-- La subconsulta pasa por la RLS de usuario_rol con el rol de quien consulta,
-- así que tampoco ve asignaciones fuera de app.banco_id. app.usuario_id se
-- compara como texto por la misma razón que en usuario_rol_propias: el
-- importador y las pruebas ponen etiquetas que no son UUID.
--
-- Sin TO: el rol sigba_app lo crea rol-de-api.sql, después de las
-- migraciones, y en una base nueva todavía no existe. Para el dueño y
-- sigba_identity_lookup no cambia nada: sus políticas ya les dejan leer todo.
CREATE POLICY usuario_propio_o_del_banco ON "plataforma"."usuario"
    FOR SELECT
    USING (
        id::text = NULLIF(current_setting('app.usuario_id', true), '')
        OR EXISTS (
            SELECT 1
            FROM "plataforma"."usuario_rol" ur
            WHERE ur.usuario_id = "usuario".id
              AND ur.activo
              AND ur.banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        )
    );

-- 3. Registro de tablas globales
-- Cada tabla de negocio sin banco_id se declara aquí con su control y su
-- razón. Una migración posterior agrega una tabla con un INSERT o le cambia el
-- control con un UPDATE, sin reescribir core.verificar_politicas_rls. La API
-- no lo lee: sigba_app no tiene privilegios sobre core.tabla_global.
--
--   - 'rls': RLS activo y forzado, con al menos una política (usuario).
--   - 'catalogo': sin RLS, decidido aquí y en ADR-07 (red, rol, banco).
CREATE TABLE "core"."tabla_global" (
    "esquema" TEXT NOT NULL,
    "tabla" TEXT NOT NULL,
    "control" TEXT NOT NULL,
    "razon" TEXT NOT NULL,
    CONSTRAINT "tabla_global_pkey" PRIMARY KEY ("esquema", "tabla"),
    CONSTRAINT "tabla_global_control_check" CHECK ("control" IN ('catalogo', 'rls'))
);

REVOKE ALL ON TABLE "core"."tabla_global" FROM PUBLIC;

INSERT INTO "core"."tabla_global" ("esquema", "tabla", "control", "razon") VALUES
    ('plataforma', 'red', 'catalogo', 'La red ABACO. Sin datos personales; la API solo la lee.'),
    ('plataforma', 'rol', 'catalogo', 'Catálogo de roles de Arquitectura 8.2; la API solo lo lee.'),
    -- sba-19-bancos-y-bodegas le pone RLS (solo super_admin escribe bancos, D7)
    -- y pasa esta fila a 'rls' con un UPDATE en su migración.
    ('plataforma', 'banco', 'catalogo', 'Nombre y código de cada banco, sin datos personales. Lo aislado es el banco_id de las tablas operativas.'),
    ('plataforma', 'usuario', 'rls', 'Datos de contacto de personas: cada quien ve su fila y la de quienes tienen asignación activa en su banco (SBA-61).');

-- 4. La verificación cubre también las tablas sin banco_id
-- Antes solo miraba tablas con banco_id: una tabla global nueva pasaba sin que
-- nadie decidiera cómo se protege. Ahora toda tabla de los schemas de negocio
-- tiene banco_id o está en core.tabla_global, y cualquier otra hace fallar la
-- migración. Una tabla con banco_id lleva RLS activo y forzado, con al menos
-- una política, igual que una global con control 'rls'.
--
-- Ninguna de ellas puede dar privilegios a PUBLIC: lo que lee la API lo
-- concede rol-de-api.sql, tabla por tabla.
CREATE OR REPLACE FUNCTION "core"."verificar_politicas_rls"()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        WITH tablas AS (
            SELECT n.nspname::text AS esquema,
                   c.relname::text AS tabla,
                   c.relrowsecurity AS rls,
                   c.relforcerowsecurity AS forzado,
                   c.relacl,
                   EXISTS (
                       SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'banco_id' AND NOT a.attisdropped
                   ) AS tiene_banco,
                   EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS tiene_politica
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('plataforma', 'inventario', 'beneficiarios', 'analitica')
              AND c.relkind IN ('r', 'p')
        )
        SELECT esquema, tabla, g.control, t.tabla IS NOT NULL AS existe,
               t.rls, t.forzado, t.tiene_banco, t.tiene_politica,
               EXISTS (
                   SELECT 1 FROM aclexplode(t.relacl) a WHERE a.grantee = 0
               ) AS publica
        FROM tablas t
        FULL JOIN core.tabla_global g USING (esquema, tabla)
        ORDER BY esquema, tabla
    LOOP
        IF NOT r.existe THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): %.% está registrada en core.tabla_global pero no existe.',
                r.esquema, r.tabla;
        END IF;

        IF r.publica THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): %.% da privilegios a PUBLIC.',
                r.esquema, r.tabla;
        END IF;

        IF r.control IS NULL AND NOT r.tiene_banco THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): %.% no tiene banco_id ni está registrada en core.tabla_global.',
                r.esquema, r.tabla;
        END IF;

        IF r.control IS NOT NULL AND r.tiene_banco THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): %.% tiene banco_id: no puede registrarse como global.',
                r.esquema, r.tabla;
        END IF;

        IF (r.control IS NULL OR r.control = 'rls')
           AND NOT (r.rls AND r.forzado AND r.tiene_politica) THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): %.% necesita ROW LEVEL SECURITY activo y forzado, con al menos una política.',
                r.esquema, r.tabla;
        END IF;
    END LOOP;
END;
$$;

SELECT "core"."verificar_politicas_rls"();
