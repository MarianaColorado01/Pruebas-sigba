-- =========================================================================
-- Roles y asignación por banco, incluido el rol institución acotado
-- SBA-18 · Arquitectura 8.2 · ADR-06 · ADR-07
-- =========================================================================

-- 1. Catálogo de roles (Arquitectura 8.2)
-- Los códigos son los de ROLES en @sigba/shared-types; la prueba
-- test/roles.integracion.spec.ts falla si se separan.
INSERT INTO "plataforma"."rol" ("codigo", "nombre", "descripcion") VALUES
    ('super_admin', 'Administración de la red', 'Crea bancos y ve indicadores agregados de la red. Sin acceso a datos personales de beneficiarios.'),
    ('admin_banco', 'Administración del banco', 'Administra usuarios, bodegas y parámetros; aprueba precios y resuelve alertas.'),
    ('coordinacion', 'Coordinación', 'Confirma borradores, aprueba precios, resuelve alertas y genera reportes.'),
    ('operario_bodega', 'Operario de bodega', 'Registra recepciones, salidas y traslados; crea referencias.'),
    ('voluntario', 'Voluntario', 'Registra salidas como despachador.'),
    ('consulta', 'Consulta', 'Consulta tableros y reportes agregados, sin exportación nominal de beneficiarios.'),
    ('institucion', 'Institución', 'Consulta y mantiene la lista de su institución.')
ON CONFLICT ("codigo") DO NOTHING;

-- 2. Una asignación no se repite
-- Con UNIQUE normal, dos filas (usuario, admin_banco, banco, NULL) no chocan
-- porque Postgres trata cada NULL como distinto. NULLS NOT DISTINCT (PG 15+)
-- las considera iguales.
ALTER TABLE "plataforma"."usuario_rol" DROP CONSTRAINT "usuario_rol_unico";
ALTER TABLE "plataforma"."usuario_rol"
    ADD CONSTRAINT "usuario_rol_unico"
    UNIQUE NULLS NOT DISTINCT ("usuario_id", "rol_id", "banco_id", "institucion_id");

-- 3. El alcance de la asignación depende del rol
-- super_admin: de la red, sin banco ni institución.
-- institucion: de un banco y una institución.
-- El resto: de un banco, sin institución. Un operario con institucion_id
-- quedaría filtrado por RLS a una sola institución sin que nadie lo pidiera.
--
-- institucion_id va sin FK (ADR-05): la institución es de beneficiarios, otro
-- schema, y entre schemas solo viajan identificadores. El trigger solo exige
-- que venga. Que exista y sea del banco de la asignación lo tendrá que validar
-- el servicio que asigne roles, que todavía no existe.
CREATE OR REPLACE FUNCTION "plataforma"."validar_alcance_usuario_rol"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    codigo_rol TEXT;
BEGIN
    SELECT "codigo" INTO codigo_rol FROM "plataforma"."rol" WHERE "id" = NEW.rol_id;

    IF codigo_rol = 'super_admin' THEN
        IF NEW.banco_id IS NOT NULL OR NEW.institucion_id IS NOT NULL THEN
            RAISE EXCEPTION 'super_admin es de la red: va sin banco_id ni institucion_id';
        END IF;
    ELSIF codigo_rol = 'institucion' THEN
        IF NEW.banco_id IS NULL OR NEW.institucion_id IS NULL THEN
            RAISE EXCEPTION 'institucion exige banco_id e institucion_id';
        END IF;
    ELSIF NEW.banco_id IS NULL OR NEW.institucion_id IS NOT NULL THEN
        RAISE EXCEPTION '% exige banco_id y va sin institucion_id', codigo_rol;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "usuario_rol_alcance"
    BEFORE INSERT OR UPDATE OF "rol_id", "banco_id", "institucion_id"
    ON "plataforma"."usuario_rol"
    FOR EACH ROW EXECUTE FUNCTION "plataforma"."validar_alcance_usuario_rol"();

-- 4. Fuera de un banco, cada usuario lee sus propias asignaciones
-- Para autorizar una petición la API necesita todas las asignaciones del
-- usuario, en todos sus bancos, antes de saber en cuál actúa. La política por
-- banco no lo permite, y la de super_admin tiene banco_id NULL, que ninguna
-- política por banco deja ver.
--
-- Esta política es permisiva, así que se suma con OR a usuario_rol_isolation,
-- y solo cubre SELECT: escribir sigue exigiendo el contexto de banco. Vale solo
-- sin app.banco_id, que es como lee el guard. La API fija app.usuario_id en
-- todas las transacciones de la petición, y sin esa condición un usuario que
-- actúa en el banco A vería también sus asignaciones del banco B (ADR-07).
--
-- app.usuario_id se compara como texto, sin cast. En peticiones HTTP lleva el
-- id que la API resolvió desde el token, pero el importador y las pruebas ponen
-- etiquetas como 'importar-codigos', y un ::uuid sobre ellas lanza «invalid
-- input syntax for type uuid». Postgres no garantiza en qué orden evalúa un
-- AND, así que la condición del banco no bastaría para proteger el cast.
DROP POLICY IF EXISTS usuario_rol_propias ON "plataforma"."usuario_rol";
CREATE POLICY usuario_rol_propias ON "plataforma"."usuario_rol"
    FOR SELECT
    USING (
        NULLIF(current_setting('app.banco_id', true), '') IS NULL
        AND usuario_id::text = NULLIF(current_setting('app.usuario_id', true), '')
    );

SELECT "core"."verificar_politicas_rls"();
