-- =========================================================================
-- Registro nominal (migración B del esquema de beneficiarios)
-- SBA-15 · ADR-07 · ADR-15 · docs/SBA-15/esquema_beneficiarios.md sección 6
-- =========================================================================
--
-- Solo datos sintéticos: el número de documento va en claro. Antes del primer
-- dato real SBA-31 agrega documento_cifrado y documento_hmac, mueve el UNIQUE
-- a (banco_id, documento_hmac) y quita numero_documento (sección 9). Ninguna
-- FK apunta a numero_documento: el cambio no toca otras tablas.
--
-- No concede privilegios: los GRANT van en prisma/roles/rol-de-api.sql.

-- 1. Enums

CREATE TYPE "beneficiarios"."tipo_documento" AS ENUM ('cc', 'ce', 'ti', 'pasaporte', 'registro_civil', 'pep', 'ppt');

CREATE TYPE "beneficiarios"."sexo" AS ENUM ('masculino', 'femenino', 'prefiero_no_decirlo');

CREATE TYPE "beneficiarios"."parentesco" AS ENUM ('madre', 'padre', 'padrastro_madrastra', 'abuelo_a', 'bisabuelo_a', 'hermano_a', 'hermanastro_a', 'tio_a', 'tio_abuelo_a', 'primo_a', 'cunado_a', 'sobrino_a', 'tutor_legal', 'otro');

CREATE TYPE "beneficiarios"."motivo_fin_representacion" AS ENUM ('mayoria_edad', 'cambio_representante', 'otro');

CREATE TYPE "beneficiarios"."motivo_fin_membresia" AS ENUM ('se_mudo', 'dejo_de_asistir', 'fallecio', 'traslado', 'otro');

CREATE TYPE "beneficiarios"."estado_alerta" AS ENUM ('abierta', 'resuelta', 'descartada');

-- 2. Persona

CREATE TABLE "beneficiarios"."persona" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "tipo_documento" "beneficiarios"."tipo_documento" NOT NULL,
    -- En claro mientras los datos sean sintéticos (SBA-31, sección 9).
    "numero_documento" VARCHAR(20) NOT NULL,
    "nombres" VARCHAR(100) NOT NULL,
    "apellidos" VARCHAR(100) NOT NULL,
    "sexo" "beneficiarios"."sexo" NOT NULL,
    "fecha_nacimiento" DATE NOT NULL,
    "telefono" VARCHAR(30),
    "direccion" VARCHAR(500),
    CONSTRAINT "persona_pkey" PRIMARY KEY ("id"),
    -- La API normaliza antes de guardar: «1.088.123.456» llega como 1088123456.
    CONSTRAINT "persona_numero_documento_normalizado"
        CHECK ("numero_documento" ~ '^[0-9A-Z]+$')
);

CREATE UNIQUE INDEX "persona_banco_id_id_key" ON "beneficiarios"."persona"("banco_id", "id");

-- Sin el tipo: la TI y la cédula de la misma persona tienen el mismo número (D2).
CREATE UNIQUE INDEX "persona_banco_id_numero_documento_key" ON "beneficiarios"."persona"("banco_id", "numero_documento");

-- 3. Beneficiario

CREATE TABLE "beneficiarios"."beneficiario" (
    "persona_id" UUID NOT NULL,
    "banco_id" UUID NOT NULL,
    "tipo_poblacion_id" UUID NOT NULL,
    CONSTRAINT "beneficiario_pkey" PRIMARY KEY ("persona_id")
);

CREATE UNIQUE INDEX "beneficiario_banco_id_persona_id_key" ON "beneficiarios"."beneficiario"("banco_id", "persona_id");

-- 4. Representación de un menor

CREATE TABLE "beneficiarios"."representacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "beneficiario_id" UUID NOT NULL,
    "representante_persona_id" UUID NOT NULL,
    "parentesco" "beneficiarios"."parentesco" NOT NULL,
    "inicio_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "fin_en" TIMESTAMPTZ,
    "motivo_fin" "beneficiarios"."motivo_fin_representacion",
    CONSTRAINT "representacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "representacion_no_a_si_mismo"
        CHECK ("representante_persona_id" <> "beneficiario_id"),
    CONSTRAINT "representacion_fin_despues_de_inicio"
        CHECK ("fin_en" >= "inicio_en"),
    CONSTRAINT "representacion_fin_con_motivo"
        CHECK (("fin_en" IS NULL) = ("motivo_fin" IS NULL))
);

-- Un menor puede tener dos representantes vigentes, pero no el mismo dos veces.
CREATE UNIQUE INDEX "representacion_vigente_key" ON "beneficiarios"."representacion"("beneficiario_id", "representante_persona_id") WHERE "fin_en" IS NULL;

-- Para la política de persona.
CREATE INDEX "representacion_representante_vigente_idx" ON "beneficiarios"."representacion"("representante_persona_id") WHERE "fin_en" IS NULL;

-- 5. Consentimiento (append-only: ningún privilegio ni política permite UPDATE o DELETE)

CREATE TABLE "beneficiarios"."consentimiento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    -- NULL: autoriza el titular. Para un menor, su representante.
    "otorgante_persona_id" UUID,
    "recogido_por" VARCHAR(100) NOT NULL,
    "otorgado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "version_aviso" VARCHAR(20) NOT NULL,
    "finalidad" TEXT NOT NULL,
    -- NOT NULL antes del primer dato real, cuando exista el almacén (D43).
    "soporte_clave" VARCHAR(100),
    CONSTRAINT "consentimiento_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "consentimiento_otorgante_distinto"
        CHECK ("otorgante_persona_id" <> "persona_id")
);

CREATE INDEX "consentimiento_banco_id_persona_id_otorgado_en_idx" ON "beneficiarios"."consentimiento"("banco_id", "persona_id", "otorgado_en" DESC);

-- 6. Membresía

CREATE TABLE "beneficiarios"."membresia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "beneficiario_id" UUID NOT NULL,
    "institucion_id" UUID NOT NULL,
    "inicio_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "fin_en" TIMESTAMPTZ,
    "motivo_fin" "beneficiarios"."motivo_fin_membresia",
    "creado_por" VARCHAR(100) NOT NULL,
    "cerrado_por" VARCHAR(100),
    CONSTRAINT "membresia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "membresia_fin_despues_de_inicio"
        CHECK ("fin_en" >= "inicio_en"),
    CONSTRAINT "membresia_cierre_completo"
        CHECK (("fin_en" IS NULL) = ("motivo_fin" IS NULL) AND ("fin_en" IS NULL) = ("cerrado_por" IS NULL))
);

CREATE UNIQUE INDEX "membresia_banco_id_id_key" ON "beneficiarios"."membresia"("banco_id", "id");

-- La regla central del módulo (SBA-15, criterio 1): una sola activa por beneficiario.
CREATE UNIQUE INDEX "membresia_activa_key" ON "beneficiarios"."membresia"("beneficiario_id") WHERE "fin_en" IS NULL;

CREATE INDEX "membresia_institucion_id_fin_en_idx" ON "beneficiarios"."membresia"("institucion_id", "fin_en");

CREATE INDEX "membresia_beneficiario_id_inicio_en_idx" ON "beneficiarios"."membresia"("beneficiario_id", "inicio_en" DESC);

-- 7. Alerta de duplicidad

CREATE TABLE "beneficiarios"."alerta_duplicidad" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "banco_id" UUID NOT NULL,
    "beneficiario_id" UUID NOT NULL,
    "institucion_solicitante_id" UUID NOT NULL,
    "membresia_vigente_id" UUID NOT NULL,
    "estado" "beneficiarios"."estado_alerta" NOT NULL DEFAULT 'abierta',
    "creado_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "creado_por" VARCHAR(100) NOT NULL,
    CONSTRAINT "alerta_duplicidad_pkey" PRIMARY KEY ("id")
);

-- Destino del ON CONFLICT del alta (sección 7.2).
CREATE UNIQUE INDEX "alerta_duplicidad_abierta_key" ON "beneficiarios"."alerta_duplicidad"("beneficiario_id", "institucion_solicitante_id") WHERE "estado" = 'abierta';

CREATE INDEX "alerta_duplicidad_banco_id_estado_creado_en_idx" ON "beneficiarios"."alerta_duplicidad"("banco_id", "estado", "creado_en");

-- 8. FK compuestas: PostgreSQL comprueba una FK sin aplicar RLS, así que una
-- FK simple dejaría colgar una fila del banco A de una del banco B.

ALTER TABLE "beneficiarios"."beneficiario"
    ADD CONSTRAINT "beneficiario_banco_id_persona_id_fkey"
    FOREIGN KEY ("banco_id", "persona_id") REFERENCES "beneficiarios"."persona"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beneficiarios"."beneficiario"
    ADD CONSTRAINT "beneficiario_banco_id_tipo_poblacion_id_fkey"
    FOREIGN KEY ("banco_id", "tipo_poblacion_id") REFERENCES "beneficiarios"."tipo_poblacion"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beneficiarios"."representacion"
    ADD CONSTRAINT "representacion_banco_id_beneficiario_id_fkey"
    FOREIGN KEY ("banco_id", "beneficiario_id") REFERENCES "beneficiarios"."beneficiario"("banco_id", "persona_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beneficiarios"."representacion"
    ADD CONSTRAINT "representacion_banco_id_representante_persona_id_fkey"
    FOREIGN KEY ("banco_id", "representante_persona_id") REFERENCES "beneficiarios"."persona"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lo que llega a consentimiento (append-only) y a membresía no se reescribe
-- por cascada: un UPDATE de persona.id falla en vez de cambiar esas filas.
ALTER TABLE "beneficiarios"."consentimiento"
    ADD CONSTRAINT "consentimiento_banco_id_persona_id_fkey"
    FOREIGN KEY ("banco_id", "persona_id") REFERENCES "beneficiarios"."persona"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "beneficiarios"."consentimiento"
    ADD CONSTRAINT "consentimiento_banco_id_otorgante_persona_id_fkey"
    FOREIGN KEY ("banco_id", "otorgante_persona_id") REFERENCES "beneficiarios"."persona"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "beneficiarios"."membresia"
    ADD CONSTRAINT "membresia_banco_id_beneficiario_id_fkey"
    FOREIGN KEY ("banco_id", "beneficiario_id") REFERENCES "beneficiarios"."beneficiario"("banco_id", "persona_id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "beneficiarios"."membresia"
    ADD CONSTRAINT "membresia_banco_id_institucion_id_fkey"
    FOREIGN KEY ("banco_id", "institucion_id") REFERENCES "beneficiarios"."institucion"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "beneficiarios"."alerta_duplicidad"
    ADD CONSTRAINT "alerta_duplicidad_banco_id_beneficiario_id_fkey"
    FOREIGN KEY ("banco_id", "beneficiario_id") REFERENCES "beneficiarios"."beneficiario"("banco_id", "persona_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beneficiarios"."alerta_duplicidad"
    ADD CONSTRAINT "alerta_duplicidad_banco_id_institucion_solicitante_id_fkey"
    FOREIGN KEY ("banco_id", "institucion_solicitante_id") REFERENCES "beneficiarios"."institucion"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "beneficiarios"."alerta_duplicidad"
    ADD CONSTRAINT "alerta_duplicidad_banco_id_membresia_vigente_id_fkey"
    FOREIGN KEY ("banco_id", "membresia_vigente_id") REFERENCES "beneficiarios"."membresia"("banco_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9. Row Level Security · ADR-07 · sección 6.8
--
-- Sin institución en el contexto (admin_banco, coordinación, operario,
-- voluntario) la sesión ve y escribe su banco. Con institución solo lee lo que
-- cuelga de una membresía activa en ella, y no escribe nada hasta el portal
-- (SBA-44, SBA-45): el WITH CHECK exige el contexto sin institución (D50).

ALTER TABLE "beneficiarios"."persona" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."persona" FORCE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."beneficiario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."beneficiario" FORCE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."representacion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."representacion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."consentimiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."consentimiento" FORCE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."membresia" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."membresia" FORCE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."alerta_duplicidad" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beneficiarios"."alerta_duplicidad" FORCE ROW LEVEL SECURITY;

-- La condición no consulta la propia tabla: PostgreSQL rechaza esa recursión.
CREATE POLICY membresia_isolation ON "beneficiarios"."membresia"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR (
                institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
                AND fin_en IS NULL
            )
        )
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    );

CREATE POLICY beneficiario_isolation ON "beneficiarios"."beneficiario"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR EXISTS (
                SELECT 1 FROM "beneficiarios"."membresia" m
                WHERE m.beneficiario_id = beneficiario.persona_id
                  AND m.fin_en IS NULL
                  AND m.institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
            )
        )
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    );

CREATE POLICY representacion_isolation ON "beneficiarios"."representacion"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR EXISTS (
                SELECT 1 FROM "beneficiarios"."membresia" m
                WHERE m.beneficiario_id = representacion.beneficiario_id
                  AND m.fin_en IS NULL
                  AND m.institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
            )
        )
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    );

-- Beneficiaria con membresía activa en la institución, o representante
-- vigente de un beneficiario con membresía activa en ella (D39).
CREATE POLICY persona_isolation ON "beneficiarios"."persona"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR EXISTS (
                SELECT 1 FROM "beneficiarios"."membresia" m
                WHERE m.beneficiario_id = persona.id
                  AND m.fin_en IS NULL
                  AND m.institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
            )
            OR EXISTS (
                SELECT 1
                FROM "beneficiarios"."representacion" r
                JOIN "beneficiarios"."membresia" m ON m.beneficiario_id = r.beneficiario_id
                WHERE r.representante_persona_id = persona.id
                  AND r.fin_en IS NULL
                  AND m.fin_en IS NULL
                  AND m.institucion_id = NULLIF(current_setting('app.institucion_id', true), '')::uuid
            )
        )
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    );

-- Solo SELECT e INSERT. La subconsulta pasa por la política de persona: la
-- institución ve el consentimiento si ve al titular.
CREATE POLICY consentimiento_lectura ON "beneficiarios"."consentimiento"
    FOR SELECT
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND (
            NULLIF(current_setting('app.institucion_id', true), '') IS NULL
            OR EXISTS (
                SELECT 1 FROM "beneficiarios"."persona" p
                WHERE p.id = consentimiento.persona_id
            )
        )
    );

CREATE POLICY consentimiento_insercion ON "beneficiarios"."consentimiento"
    FOR INSERT
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    );

-- La alerta revela en qué otra institución está la persona (RNF-M2-05): con
-- institución en el contexto no se ve.
CREATE POLICY alerta_duplicidad_isolation ON "beneficiarios"."alerta_duplicidad"
    FOR ALL
    USING (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    )
    WITH CHECK (
        banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
        AND NULLIF(current_setting('app.institucion_id', true), '') IS NULL
    );

-- 10. Falla la migración si alguna tabla con banco_id quedó sin política
SELECT "core"."verificar_politicas_rls"();
