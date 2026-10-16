-- =========================================================================
-- Invitaciones a un banco y su aceptación
-- SBA-19 · ADR-06 · ADR-07 · docs/arquitectura/plataforma-sba-19.md (D4, D5)
-- =========================================================================

-- 1. Tabla
-- El token no se guarda: solo su SHA-256 en hex. Reenviar reemplaza el hash
-- en la misma fila, así que el enlace anterior deja de servir.
CREATE TABLE "plataforma"."invitacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "rol_id" UUID NOT NULL,
    -- Sin FK, como en usuario_rol: la institución es de beneficiarios (ADR-05).
    "institucion_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "vence_en" TIMESTAMPTZ NOT NULL,
    "aceptada_en" TIMESTAMPTZ,
    "aceptada_por" UUID,
    "revocada_en" TIMESTAMPTZ,
    "creado_por" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invitacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitacion_token_hash_key" UNIQUE ("token_hash"),
    CONSTRAINT "invitacion_token_hash_check" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "invitacion_aceptada_completa"
        CHECK (("aceptada_en" IS NULL) = ("aceptada_por" IS NULL)),
    CONSTRAINT "invitacion_aceptada_o_revocada"
        CHECK ("aceptada_en" IS NULL OR "revocada_en" IS NULL),
    CONSTRAINT "invitacion_banco_id_fkey" FOREIGN KEY ("banco_id")
        REFERENCES "plataforma"."banco"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invitacion_rol_id_fkey" FOREIGN KEY ("rol_id")
        REFERENCES "plataforma"."rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invitacion_aceptada_por_fkey" FOREIGN KEY ("aceptada_por")
        REFERENCES "plataforma"."usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "invitacion_creado_por_fkey" FOREIGN KEY ("creado_por")
        REFERENCES "plataforma"."usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- La lista de la pantalla de usuarios: las del banco, las más nuevas primero.
CREATE INDEX "invitacion_banco_id_creado_en_idx"
    ON "plataforma"."invitacion" ("banco_id", "creado_en");

-- Una invitación pendiente por banco y correo, sin distinguir mayúsculas. Las
-- aceptadas y las revocadas no cuentan: la misma persona puede volver a ser
-- invitada. Prisma no expresa índices parciales; este vive solo aquí.
CREATE UNIQUE INDEX "invitacion_pendiente_por_correo_key"
    ON "plataforma"."invitacion" ("banco_id", lower("email"))
    WHERE "aceptada_en" IS NULL AND "revocada_en" IS NULL;

-- 2. Row Level Security · ADR-07
ALTER TABLE "plataforma"."invitacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plataforma"."invitacion" FORCE ROW LEVEL SECURITY;

CREATE POLICY invitacion_banco_isolation ON "plataforma"."invitacion"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

-- Quien acepta todavía no tiene banco: la invitación se busca por el hash del
-- token, antes de saber de qué banco es. Eso lo hace plataforma.aceptar_invitacion,
-- que corre como el dueño, y con FORCE RLS el dueño también pasa por las
-- políticas. Esta solo vale para él; la API nunca se conecta como dueño
-- (rol-de-api.sql lo rechaza), igual que usuario_administracion.
DO $$
BEGIN
    EXECUTE format(
        'CREATE POLICY invitacion_aceptacion ON plataforma.invitacion FOR ALL TO %I USING (true) WITH CHECK (true)',
        current_user
    );
END;
$$;

-- 3. Aceptación (D5)
-- Todo en una transacción y con la fila bloqueada: dos aceptaciones del mismo
-- enlace no crean dos asignaciones. Devuelve un resultado en vez de lanzar,
-- para que la API responda con el código que la PWA explica:
--   aceptada, no_existe, revocada, usada, vencida, correo_en_uso,
--   correo_no_verificado, correo_no_coincide, usuario_inactivo o banco_inactivo.
-- Aceptar otra vez con la misma cuenta vuelve a dar 'aceptada': la PWA puede
-- reintentar si se cortó la señal después de confirmar.
--
-- Quien acepta tiene que probar que el correo es suyo (D3): p_email es el
-- correo verificado del access token, o NULL si el token no lo trae o no está
-- verificado. Se compara sin mayúsculas ni espacios en los extremos, y la
-- respuesta no dice a qué correo se invitó. Si la persona es nueva,
-- usuario.email y usuario.nombre salen de la invitación. correo_en_uso es otra
-- cuenta de SIGBA con ese correo: probablemente la misma persona con otro
-- inicio de sesión, y no se adivina cuál vale. Una cuenta o un banco inactivos
-- no reciben asignaciones nuevas.
--
-- Fija app.banco_id y app.usuario_id dentro de la transacción para que RLS
-- deje escribir la asignación y para auditar. La auditoría no lleva correo ni
-- token.
CREATE FUNCTION "plataforma"."aceptar_invitacion"(
    p_token_hash TEXT,
    p_emisor TEXT,
    p_auth0_sub TEXT,
    p_email TEXT
)
RETURNS TABLE (resultado TEXT, banco_id UUID, rol TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, plataforma, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    inv plataforma.invitacion%ROWTYPE;
    codigo_rol TEXT;
    id_usuario UUID;
    usuario_activo BOOLEAN;
    id_asignacion UUID;
    asignacion_nueva BOOLEAN;
BEGIN
    SELECT * INTO inv
    FROM plataforma.invitacion i
    WHERE i.token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'no_existe'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT r.codigo INTO codigo_rol FROM plataforma.rol r WHERE r.id = inv.rol_id;

    -- Antes de decir nada más del enlace: quien no prueba el correo no aprende
    -- si está revocado, usado o vencido.
    IF nullif(btrim(p_email), '') IS NULL THEN
        RETURN QUERY SELECT 'correo_no_verificado'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;
    IF lower(btrim(p_email)) <> lower(btrim(inv.email)) THEN
        RETURN QUERY SELECT 'correo_no_coincide'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    SELECT u.id, u.activo INTO id_usuario, usuario_activo
    FROM plataforma.usuario u
    WHERE u.emisor = p_emisor AND u.auth0_sub = p_auth0_sub;

    IF inv.revocada_en IS NOT NULL THEN
        RETURN QUERY SELECT 'revocada'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF inv.aceptada_en IS NOT NULL THEN
        IF inv.aceptada_por = id_usuario THEN
            RETURN QUERY SELECT 'aceptada'::text, inv.banco_id, codigo_rol;
        ELSE
            RETURN QUERY SELECT 'usada'::text, NULL::uuid, NULL::text;
        END IF;
        RETURN;
    END IF;

    IF inv.vence_en <= now() THEN
        RETURN QUERY SELECT 'vencida'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF id_usuario IS NOT NULL AND NOT usuario_activo THEN
        RETURN QUERY SELECT 'usuario_inactivo'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM plataforma.banco b WHERE b.id = inv.banco_id AND b.activo) THEN
        RETURN QUERY SELECT 'banco_inactivo'::text, NULL::uuid, NULL::text;
        RETURN;
    END IF;

    IF id_usuario IS NULL THEN
        IF EXISTS (SELECT 1 FROM plataforma.usuario u WHERE lower(u.email) = lower(inv.email)) THEN
            RETURN QUERY SELECT 'correo_en_uso'::text, NULL::uuid, NULL::text;
            RETURN;
        END IF;

        INSERT INTO plataforma.usuario (emisor, auth0_sub, email, nombre)
        VALUES (p_emisor, p_auth0_sub, inv.email, inv.nombre)
        RETURNING id INTO id_usuario;
    END IF;

    PERFORM set_config('app.banco_id', inv.banco_id::text, true);
    PERFORM set_config('app.institucion_id', '', true);
    PERFORM set_config('app.usuario_id', id_usuario::text, true);

    -- Una asignación que el banco desactivó (D15) vuelve con la invitación.
    -- xmax = 0 en la fila devuelta distingue el INSERT de la rama DO UPDATE.
    INSERT INTO plataforma.usuario_rol AS ur (usuario_id, rol_id, banco_id, institucion_id)
    VALUES (id_usuario, inv.rol_id, inv.banco_id, inv.institucion_id)
    ON CONFLICT ON CONSTRAINT usuario_rol_unico
        DO UPDATE SET activo = true, actualizado_en = now()
    RETURNING ur.id, ur.xmax = 0 INTO id_asignacion, asignacion_nueva;

    UPDATE plataforma.invitacion i
    SET aceptada_en = now(), aceptada_por = id_usuario
    WHERE i.id = inv.id;

    PERFORM core.registrar_auditoria(
        'actualizar', 'invitacion', inv.id::text, NULL,
        '{"camposModificados": ["aceptada_en", "aceptada_por"]}'::jsonb
    );
    IF asignacion_nueva THEN
        PERFORM core.registrar_auditoria('crear', 'usuario_rol', id_asignacion::text);
    ELSE
        PERFORM core.registrar_auditoria(
            'actualizar', 'usuario_rol', id_asignacion::text, NULL,
            '{"camposModificados": ["activo"]}'::jsonb
        );
    END IF;

    RETURN QUERY SELECT 'aceptada'::text, inv.banco_id, codigo_rol;
END;
$$;

REVOKE ALL ON FUNCTION "plataforma"."aceptar_invitacion"(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;

-- El GRANT EXECUTE a sigba_app va en prisma/roles/rol-de-api.sql.

SELECT "core"."verificar_politicas_rls"();
