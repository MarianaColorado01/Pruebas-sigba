-- =========================================================================
-- Migración Inicial: Schemas, Tablas de Plataforma y Row Level Security (RLS)
-- SBA-6 · ADR-05 · ADR-07
-- =========================================================================

-- 1. Crear los 5 schemas del monolito modular
CREATE SCHEMA IF NOT EXISTS "core";
CREATE SCHEMA IF NOT EXISTS "plataforma";
CREATE SCHEMA IF NOT EXISTS "inventario";
CREATE SCHEMA IF NOT EXISTS "beneficiarios";
CREATE SCHEMA IF NOT EXISTS "analitica";

-- 2. Tablas base del schema plataforma

-- Red (global)
CREATE TABLE IF NOT EXISTS "plataforma"."red" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" VARCHAR(200) NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "red_pkey" PRIMARY KEY ("id")
);

-- Banco (pertenece a red)
CREATE TABLE IF NOT EXISTS "plataforma"."banco" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "red_id" UUID NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "banco_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "banco_codigo_key" UNIQUE ("codigo"),
    CONSTRAINT "banco_red_id_fkey" FOREIGN KEY ("red_id") REFERENCES "plataforma"."red"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Bodega (aislada por banco_id)
CREATE TABLE IF NOT EXISTS "plataforma"."bodega" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "direccion" VARCHAR(500),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bodega_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bodega_banco_id_fkey" FOREIGN KEY ("banco_id") REFERENCES "plataforma"."banco"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Usuario
CREATE TABLE IF NOT EXISTS "plataforma"."usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "auth0_sub" VARCHAR(200) NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usuario_auth0_sub_key" UNIQUE ("auth0_sub"),
    CONSTRAINT "usuario_email_key" UNIQUE ("email")
);

-- Rol
CREATE TABLE IF NOT EXISTS "plataforma"."rol" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "codigo" VARCHAR(50) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(500),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rol_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "rol_codigo_key" UNIQUE ("codigo")
);

-- UsuarioRol (aislado por banco_id e institucion_id cuando aplique)
CREATE TABLE IF NOT EXISTS "plataforma"."usuario_rol" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "rol_id" UUID NOT NULL,
    "banco_id" UUID,
    "institucion_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usuario_rol_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usuario_rol_unico" UNIQUE ("usuario_id", "rol_id", "banco_id", "institucion_id"),
    CONSTRAINT "usuario_rol_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "plataforma"."usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "usuario_rol_rol_id_fkey" FOREIGN KEY ("rol_id") REFERENCES "plataforma"."rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "usuario_rol_banco_id_fkey" FOREIGN KEY ("banco_id") REFERENCES "plataforma"."banco"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- ParametroBanco (aislado por banco_id con vigencia)
CREATE TABLE IF NOT EXISTS "plataforma"."parametro_banco" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "clave" VARCHAR(100) NOT NULL,
    "valor" TEXT NOT NULL,
    "vigente_desde" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_hasta" TIMESTAMPTZ,
    "creado_por" VARCHAR(100),
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "parametro_banco_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "parametro_banco_banco_id_fkey" FOREIGN KEY ("banco_id") REFERENCES "plataforma"."banco"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "parametro_banco_banco_id_clave_vigente_desde_idx" 
ON "plataforma"."parametro_banco"("banco_id", "clave", "vigente_desde");

-- 3. Row Level Security (RLS) · ADR-07
-- Las variables de sesión son fijadas con SET LOCAL en cada transacción:
-- app.banco_id y app.institucion_id

-- Bodega
ALTER TABLE "plataforma"."bodega" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plataforma"."bodega" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bodega_banco_isolation ON "plataforma"."bodega";
CREATE POLICY bodega_banco_isolation ON "plataforma"."bodega"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- ParametroBanco
ALTER TABLE "plataforma"."parametro_banco" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plataforma"."parametro_banco" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parametro_banco_isolation ON "plataforma"."parametro_banco";
CREATE POLICY parametro_banco_isolation ON "plataforma"."parametro_banco"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- UsuarioRol
ALTER TABLE "plataforma"."usuario_rol" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plataforma"."usuario_rol" FORCE ROW LEVEL SECURITY;

-- El contexto viaja en app.banco_id, que siempre es un UUID o cadena vacía.
-- Una versión anterior aceptaba aquí la cadena literal 'super_admin' para dar
-- acceso a las asignaciones globales. Eso rompía las demás políticas: bodega y
-- parametro_banco castean esa misma variable a uuid, y 'super_admin'::uuid
-- lanza «invalid input syntax for type uuid», así que una sesión de super_admin
-- reventaba al consultar cualquier otra tabla en lugar de ver o no ver filas.
-- El alcance de super_admin se resuelve en la API por rol (Arquitectura 8.2),
-- no colando un valor no-UUID en la variable de tenant.
DROP POLICY IF EXISTS usuario_rol_isolation ON "plataforma"."usuario_rol";
CREATE POLICY usuario_rol_isolation ON "plataforma"."usuario_rol"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
        )
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
        )
    );

-- 4. Función de verificación de integridad RLS (ADR-07)
-- Falla la migración si cualquier tabla de dominio tiene columna 'banco_id'
-- y carece de RLS activo y al menos una política definida.
CREATE OR REPLACE FUNCTION "core"."verificar_politicas_rls"()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    r RECORD;
    tiene_rls BOOLEAN;
    num_politicas INTEGER;
BEGIN
    FOR r IN (
        SELECT 
            c.table_schema,
            c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t 
            ON c.table_schema = t.table_schema AND c.table_name = t.table_name
        WHERE c.table_schema IN ('plataforma', 'inventario', 'beneficiarios', 'analitica')
          AND t.table_type = 'BASE TABLE'
          AND c.column_name = 'banco_id'
    ) LOOP
        -- Verificar si la tabla tiene RLS activo (relrowsecurity = true)
        SELECT cl.relrowsecurity INTO tiene_rls
        FROM pg_class cl
        JOIN pg_namespace ns ON cl.relnamespace = ns.oid
        WHERE ns.nspname = r.table_schema
          AND cl.relname = r.table_name;

        IF tiene_rls IS NOT TRUE THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): La tabla %.% tiene columna banco_id pero no tiene ROW LEVEL SECURITY activo.',
                r.table_schema, r.table_name;
        END IF;

        -- Verificar si tiene al menos una política definida
        SELECT COUNT(*) INTO num_politicas
        FROM pg_policy p
        JOIN pg_class cl ON p.polrelid = cl.oid
        JOIN pg_namespace ns ON cl.relnamespace = ns.oid
        WHERE ns.nspname = r.table_schema
          AND cl.relname = r.table_name;

        IF num_politicas = 0 THEN
            RAISE EXCEPTION 'Violación de seguridad (ADR-07): La tabla %.% tiene RLS activo pero no tiene políticas definidas.',
                r.table_schema, r.table_name;
        END IF;
    END LOOP;
END;
$$;

-- 5. Ejecutar la verificación: falla si alguna tabla de dominio no cumple
SELECT "core"."verificar_politicas_rls"();
