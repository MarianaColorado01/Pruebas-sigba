-- =========================================================================
-- Rol de la API: sigba_app (ADR-07, Arquitectura 8.1)
-- =========================================================================
--
-- Única fuente de los privilegios del rol con que se conecta la API. Se
-- aplica después de cada `prisma migrate deploy`:
--
--   pnpm --filter @sigba/api run db:roles
--
-- Es idempotente y converge: primero quita todo lo que sigba_app tenga sobre
-- los schemas de negocio y después concede lo que está escrito aquí. Borrar
-- una línea quita el privilegio en la siguiente aplicación.
--
-- Crea el rol sin LOGIN. La clave no vive en Git: quien opera cada ambiente
-- corre aparte `ALTER ROLE sigba_app LOGIN PASSWORD '...'` (ver
-- docs/arquitectura/rol-de-api.md). Volver a aplicar este script no toca ni
-- LOGIN ni la clave.
--
-- Las pruebas de integración aplican este mismo archivo y se conectan como
-- sigba_app: una tabla nueva sin su línea aquí rompe CI.

BEGIN;

-- 1. El rol existe y no se salta RLS ni los GRANT
-- Si ya existe no se corrige en silencio: se rechaza. Un rol creado desde la
-- consola de Neon entra como miembro de neon_superuser y hereda sus
-- privilegios, así que aquí tampoco se acepta que sea miembro de otro rol.
DO $$
DECLARE
    r pg_roles%ROWTYPE;
BEGIN
    SELECT * INTO r FROM pg_roles WHERE rolname = 'sigba_app';

    IF NOT FOUND THEN
        CREATE ROLE sigba_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
        RETURN;
    END IF;

    IF r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb THEN
        RAISE EXCEPTION 'sigba_app no puede ser superusuario ni tener BYPASSRLS, CREATEROLE o CREATEDB';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) THEN
        RAISE EXCEPTION 'sigba_app no puede ser miembro de otro rol: heredaría sus privilegios';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relowner = r.oid
          AND n.nspname IN ('core', 'plataforma', 'inventario', 'beneficiarios', 'analitica')
    ) THEN
        RAISE EXCEPTION 'sigba_app no puede ser dueño de tablas: el dueño no necesita GRANT';
    END IF;
END $$;

-- 2. Punto de partida: nada
REVOKE ALL ON SCHEMA core, plataforma, inventario, beneficiarios, analitica FROM sigba_app;
REVOKE ALL ON ALL TABLES IN SCHEMA core, plataforma, inventario, beneficiarios, analitica FROM sigba_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA core, plataforma, inventario, beneficiarios, analitica FROM sigba_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA core, plataforma, inventario, beneficiarios, analitica FROM sigba_app;

GRANT USAGE ON SCHEMA core, plataforma, inventario, beneficiarios, analitica TO sigba_app;

-- 3. Tablas, una línea por tabla
-- Nadie tiene DELETE: la API no borra filas. Una tabla append-only (movimiento,
-- auditoría) nunca recibe UPDATE (ADR-08).

-- plataforma: las globales (ADR-07) solo se leen; las del banco tienen RLS.
GRANT SELECT ON plataforma.red TO sigba_app;
GRANT SELECT ON plataforma.banco TO sigba_app;
GRANT SELECT ON plataforma.usuario TO sigba_app;
GRANT SELECT ON plataforma.rol TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON plataforma.bodega TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON plataforma.parametro_banco TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON plataforma.usuario_rol TO sigba_app;

-- inventario
GRANT SELECT, INSERT, UPDATE ON inventario.categoria TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON inventario.producto TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON inventario.referencia TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON inventario.donante TO sigba_app;

-- beneficiarios: ninguna tabla admite DELETE (esquema v5.0, sección 4).
GRANT SELECT, INSERT, UPDATE ON beneficiarios.tipo_poblacion TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON beneficiarios.institucion TO sigba_app;

-- 4. Funciones SECURITY DEFINER
-- Cada migración que cree una función SECURITY DEFINER le quita EXECUTE a
-- PUBLIC y añade aquí su GRANT EXECUTE a sigba_app, en el mismo PR. La
-- migración no concede nada a sigba_app.
--
-- Pendientes al rebasar sobre este cambio:
--   #20: core.registrar_auditoria(text, text, text, text, jsonb) y SELECT en core.auditoria

-- Identidad de Auth0 antes de que exista contexto de tenant (SBA-8).
GRANT EXECUTE ON FUNCTION plataforma.resolver_usuario_auth0(text, text) TO sigba_app;

COMMIT;
