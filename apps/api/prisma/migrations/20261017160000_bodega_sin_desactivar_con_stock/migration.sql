-- =========================================================================
-- Una bodega con stock no se desactiva
-- SBA-76 · ADR-05 · ADR-08
-- =========================================================================
--
-- Recibir, dar de baja y trasladar exigen bodega activa. Si se desactiva una
-- bodega con saldo, lo que queda en ella no se puede mover ni sacar. Primero
-- se traslada o se da de baja; después se desactiva.
--
-- La regla vive en la base y no en el servicio de plataforma: así plataforma
-- no depende del módulo de inventario y ningún camino la salta. Corre con los
-- permisos y el contexto de quien escribe: la escritura de la bodega ya fija
-- app.banco_id, y sigba_app lee el saldo de ese banco.

CREATE FUNCTION "plataforma"."rechazar_desactivar_con_stock"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM inventario.saldo
        WHERE banco_id = NEW.banco_id AND bodega_id = NEW.id AND cantidad > 0
    ) THEN
        RAISE EXCEPTION 'bodega_con_stock: la bodega % tiene saldo', NEW.id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "plataforma"."rechazar_desactivar_con_stock"() FROM PUBLIC;

CREATE TRIGGER "bodega_sin_desactivar_con_stock"
    BEFORE UPDATE OF "activa" ON "plataforma"."bodega"
    FOR EACH ROW
    WHEN (OLD."activa" AND NOT NEW."activa")
    EXECUTE FUNCTION "plataforma"."rechazar_desactivar_con_stock"();
