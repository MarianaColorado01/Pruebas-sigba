-- SBA-49 · Despachador del outbox: lease, acuse por consumidor y reintentos (ADR-09).
--
-- El despachador corre en la API y entrega cada evento a los consumidores en
-- proceso. Cuatro funciones SECURITY DEFINER son su única vía al outbox:
--
-- 1. core.reclamar_eventos toma un lote de pendientes de todos los bancos,
--    les cuenta el intento y les pone lease. Es la única lectura que cruza bancos y devuelve lo que el
--    contrato permite en la carga: identificadores, nunca datos personales
--    (Arquitectura 8.6).
-- 2. Cada entrega corre en su propia transacción con el banco del evento en
--    app.banco_id. Ahí core.reclamar_entrega escribe el acuse del consumidor y
--    el consumidor escribe su proyección, con RLS como cualquier escritura.
-- 3. core.publicar_evento o core.posponer_evento cierran el intento, también
--    con el banco del evento en el contexto.

-- Vence el lease o el retroceso. NULL: disponible desde que se emitió.
ALTER TABLE "core"."outbox" ADD COLUMN "siguiente_intento_en" TIMESTAMPTZ;

-- El despachador busca pendientes de todos los bancos por orden de llegada;
-- outbox_pendiente_idx empieza por banco_id y no le sirve.
CREATE INDEX "outbox_por_despachar_idx"
    ON "core"."outbox" ("ocurrido_en", "id")
    WHERE "publicado_en" IS NULL;

-- Un acuse por evento y consumidor: si el evento vuelve a llegar, el
-- consumidor no lo procesa otra vez.
CREATE TABLE "core"."evento_consumido" (
    "evento_id" UUID NOT NULL,
    "consumidor" TEXT NOT NULL,
    "banco_id" UUID NOT NULL,
    "consumido_en" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "evento_consumido_pkey" PRIMARY KEY ("evento_id", "consumidor"),
    CONSTRAINT "evento_consumido_evento_fkey"
        FOREIGN KEY ("evento_id") REFERENCES "core"."outbox" ("id"),
    CONSTRAINT "evento_consumido_consumidor_check" CHECK (btrim("consumidor") <> '')
);

CREATE INDEX "evento_consumido_banco_idx"
    ON "core"."evento_consumido" ("banco_id", "consumidor");

ALTER TABLE "core"."evento_consumido" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "core"."evento_consumido" FORCE ROW LEVEL SECURITY;

-- Sin TO: bajo FORCE la cumple también el dueño, que lee aquí el acuse previo
-- desde core.reclamar_entrega.
CREATE POLICY evento_consumido_banco_select ON "core"."evento_consumido"
    FOR SELECT
    USING (
        "banco_id" = NULLIF(current_setting('app.banco_id', true), '')::uuid
    );

CREATE FUNCTION "core"."reclamar_eventos"(
    p_tipos TEXT[],
    p_limite INTEGER,
    p_tope_intentos INTEGER,
    p_lease_segundos INTEGER
)
RETURNS TABLE (
    id UUID,
    banco_id UUID,
    tipo TEXT,
    version SMALLINT,
    payload JSONB,
    ocurrido_en TIMESTAMPTZ,
    intentos INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
#variable_conflict use_column
BEGIN
    IF p_tope_intentos IS NULL OR p_tope_intentos < 1 THEN
        RAISE EXCEPTION 'El tope de intentos debe ser positivo';
    END IF;
    -- Topes para que una llamada no se lleve el outbox entero ni lo retenga
    -- por horas.
    IF p_limite IS NULL OR p_limite < 1 OR p_limite > 500 THEN
        RAISE EXCEPTION 'El límite del lote va de 1 a 500';
    END IF;
    IF p_lease_segundos IS NULL OR p_lease_segundos < 1 OR p_lease_segundos > 300 THEN
        RAISE EXCEPTION 'El lease va de 1 a 300 segundos';
    END IF;

    -- SKIP LOCKED: dos réplicas que reclaman a la vez se reparten el lote en
    -- vez de tomar los mismos eventos.
    --
    -- El intento se cuenta al reclamar, no al fallar: un evento que tumba el
    -- proceso nunca llega a posponer_evento, y así también agota sus intentos.
    -- Con intentos >= tope ya no se reclama: queda pendiente y visible como
    -- cola muerta.
    RETURN QUERY
        UPDATE core.outbox AS o
        SET intentos = o.intentos + 1,
            siguiente_intento_en = now() + make_interval(secs => p_lease_segundos)
        WHERE o.id IN (
            SELECT p.id
            FROM core.outbox AS p
            WHERE p.publicado_en IS NULL
              AND p.tipo = ANY (p_tipos)
              AND p.intentos < p_tope_intentos
              AND (p.siguiente_intento_en IS NULL OR p.siguiente_intento_en <= now())
            ORDER BY p.ocurrido_en, p.id
            LIMIT p_limite
            FOR UPDATE SKIP LOCKED
        )
        RETURNING o.id, o.banco_id, o.tipo, o.version, o.payload, o.ocurrido_en, o.intentos;
END;
$$;

-- Escribe el acuse en la transacción del consumidor. El banco sale del
-- contexto y el evento tiene que ser de ese banco. Devuelve true si este
-- consumidor no lo había procesado.
--
-- Si otra transacción ya insertó el mismo acuse sin confirmar, el INSERT
-- espera: si confirma, este devuelve false; si revierte, inserta.
CREATE FUNCTION "core"."reclamar_entrega"(p_evento_id UUID, p_consumidor TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
DECLARE
    contexto_banco UUID := NULLIF(current_setting('app.banco_id', true), '')::uuid;
BEGIN
    IF contexto_banco IS NULL THEN
        RAISE EXCEPTION 'Falta el contexto de banco para reclamar la entrega';
    END IF;

    INSERT INTO core.evento_consumido (evento_id, consumidor, banco_id)
    SELECT o.id, p_consumidor, o.banco_id
    FROM core.outbox AS o
    WHERE o.id = p_evento_id AND o.banco_id = contexto_banco
    ON CONFLICT (evento_id, consumidor) DO NOTHING;

    IF FOUND THEN
        RETURN true;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM core.evento_consumido AS c
        WHERE c.evento_id = p_evento_id AND c.consumidor = p_consumidor
    ) THEN
        RAISE EXCEPTION 'El evento % no existe en el banco del contexto', p_evento_id;
    END IF;

    RETURN false;
END;
$$;

-- Todos los consumidores acusaron el evento.
CREATE FUNCTION "core"."publicar_evento"(p_evento_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
    UPDATE core.outbox
    SET publicado_en = now(), siguiente_intento_en = NULL
    WHERE id = p_evento_id
      AND banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
      AND publicado_en IS NULL;
$$;

-- Algún consumidor falló: espera antes del siguiente intento. El intento ya
-- se contó al reclamar.
CREATE FUNCTION "core"."posponer_evento"(p_evento_id UUID, p_espera_segundos INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, core, pg_temp
AS $$
BEGIN
    IF p_espera_segundos IS NULL OR p_espera_segundos < 0 THEN
        RAISE EXCEPTION 'La espera no puede ser negativa';
    END IF;

    UPDATE core.outbox
    SET siguiente_intento_en = now() + make_interval(secs => p_espera_segundos)
    WHERE id = p_evento_id
      AND banco_id = NULLIF(current_setting('app.banco_id', true), '')::uuid
      AND publicado_en IS NULL;
END;
$$;

-- Bajo FORCE, el dueño necesita políticas propias para leer y actualizar el
-- outbox sin banco en el contexto (reclamar_eventos) y para escribir acuses.
-- Solo las funciones de arriba corren como dueño.
DO $$
DECLARE
    propietario TEXT := current_user;
BEGIN
    EXECUTE format(
        'CREATE POLICY outbox_definer_despacho_select ON core.outbox FOR SELECT TO %I
         USING (current_user = %L)',
        propietario,
        propietario
    );
    EXECUTE format(
        'CREATE POLICY outbox_definer_despacho_update ON core.outbox FOR UPDATE TO %I
         USING (current_user = %L) WITH CHECK (current_user = %L)',
        propietario,
        propietario,
        propietario
    );
    EXECUTE format(
        'CREATE POLICY evento_consumido_definer_insert ON core.evento_consumido FOR INSERT TO %I
         WITH CHECK (current_user = %L AND banco_id = NULLIF(current_setting(''app.banco_id'', true), '''')::uuid)',
        propietario,
        propietario
    );
END;
$$;

REVOKE ALL ON TABLE "core"."evento_consumido" FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."reclamar_eventos"(TEXT[], INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."reclamar_entrega"(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."publicar_evento"(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION "core"."posponer_evento"(UUID, INTEGER) FROM PUBLIC;

-- Los privilegios de sigba_app van en prisma/roles/rol-de-api.sql.
