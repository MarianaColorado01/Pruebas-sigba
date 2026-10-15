-- Unicidad del catálogo sin distinguir mayúsculas ni tildes (SBA-22).
-- «Arroz», «arroz» y «Arróz» son el mismo producto del banco; «1 KG» y «1 kg»,
-- la misma presentación del producto. unaccent también pasa la ñ a n, así que
-- «Piña» y «Pina» chocan.

CREATE EXTENSION IF NOT EXISTS unaccent;

-- unaccent() no es IMMUTABLE y Postgres no la acepta en un índice. Con el
-- diccionario explícito y el search_path fijo, el resultado no depende de la
-- sesión, así que esta envoltura sí puede serlo.
CREATE OR REPLACE FUNCTION inventario.normalizar(texto text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
SET search_path = pg_catalog, public
AS $$
    SELECT lower(public.unaccent('public.unaccent'::regdictionary, texto));
$$;

DROP INDEX "inventario"."producto_banco_id_nombre_key";
DROP INDEX "inventario"."referencia_banco_id_producto_id_presentacion_key";

CREATE UNIQUE INDEX "producto_banco_id_nombre_normalizado_key"
    ON "inventario"."producto" ("banco_id", inventario.normalizar("nombre"));

CREATE UNIQUE INDEX "referencia_banco_id_producto_id_presentacion_normalizada_key"
    ON "inventario"."referencia" ("banco_id", "producto_id", inventario.normalizar("presentacion"));
