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

-- core: auditoría append-only. Se lee por RLS y se escribe solo con
-- core.registrar_auditoria (sección 4).
GRANT SELECT ON core.auditoria TO sigba_app;

-- core: comando_procesado se escribe solo con core.reclamar_comando (sección 4).
-- El SELECT deja que las pruebas de aislamiento demuestren la política como sigba_app.
GRANT SELECT ON core.comando_procesado TO sigba_app;

-- core: outbox se escribe por su función con banco del contexto de transacción.
GRANT SELECT ON core.outbox TO sigba_app;

-- inventario
GRANT SELECT, INSERT, UPDATE ON inventario.categoria TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON inventario.producto TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON inventario.referencia TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON inventario.donante TO sigba_app;
-- Recepción (SBA-24): se escribe una vez y no se edita. El UPDATE de
-- recepcion_detalle.valoracion lo agrega la valoración de recepciones (SBA-43).
GRANT SELECT, INSERT ON inventario.recepcion TO sigba_app;
GRANT SELECT, INSERT ON inventario.lote TO sigba_app;
GRANT SELECT, INSERT ON inventario.recepcion_detalle TO sigba_app;
-- El libro es append-only (ADR-08).
GRANT SELECT, INSERT ON inventario.movimiento TO sigba_app;
-- El saldo se deriva del libro (SBA-35): lo escribe el trigger
-- inventario.sumar_al_saldo con cada movimiento; la API solo lo lee.
GRANT SELECT ON inventario.saldo TO sigba_app;
-- Maestro de precios (SBA-39): el UPDATE aprueba o acorta la vigencia; el
-- trigger de la tabla rechaza cualquier otro cambio.
GRANT SELECT, INSERT, UPDATE ON inventario.precio TO sigba_app;

-- beneficiarios
GRANT SELECT, INSERT, UPDATE ON beneficiarios.tipo_poblacion TO sigba_app;
GRANT SELECT, INSERT, UPDATE ON beneficiarios.institucion TO sigba_app;

-- 4. Funciones SECURITY DEFINER
-- Cada migración que cree una función SECURITY DEFINER le quita EXECUTE a
-- PUBLIC y añade aquí su GRANT EXECUTE a sigba_app, en el mismo PR. La
-- migración no concede nada a sigba_app.

-- Identidad de Auth0 antes de que exista contexto de tenant (SBA-8).
GRANT EXECUTE ON FUNCTION plataforma.resolver_usuario_auth0(text, text) TO sigba_app;

-- Auditoría (SBA-21): la única escritura en core.auditoria pasa por aquí.
GRANT EXECUTE ON FUNCTION core.registrar_auditoria(text, text, text, text, jsonb) TO sigba_app;

-- Idempotencia de comandos (SBA-69).
GRANT EXECUTE ON FUNCTION core.reclamar_comando(uuid, smallint, text, text, uuid) TO sigba_app;

-- Outbox transaccional (SBA-30).
GRANT EXECUTE ON FUNCTION core.emitir_evento(text, smallint, jsonb) TO sigba_app;

-- inventario.sumar_al_saldo (SBA-35) no lleva GRANT: la ejecuta el trigger
-- del libro, y Postgres no revisa EXECUTE cuando dispara un trigger.

COMMIT;
