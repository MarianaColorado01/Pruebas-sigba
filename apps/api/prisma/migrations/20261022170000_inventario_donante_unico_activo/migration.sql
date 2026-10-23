-- Un donante activo por banco, tipo y nombre (SBA-98).
--
-- El alta buscaba y creaba en dos transacciones: dos POST /donantes iguales y
-- simultáneos dejaban dos donantes activos. El índice hace que la base lo
-- impida, y el repositorio devuelve al segundo el donante que ganó.
--
-- La llave es lower(nombre): mayúsculas no cuentan, tildes sí, igual que la
-- búsqueda del alta. El nombre ya se guarda sin espacios sobrantes. Parcial
-- sobre activo, porque un donante desactivado libera su nombre.
--
-- Antes de crearlo, la migración no puede fallar por duplicados que ya
-- existan. Entre los activos de un mismo banco, tipo y nombre queda activo el
-- más antiguo y se desactivan los demás: un donante no se borra (las
-- recepciones viejas lo siguen nombrando), así que ninguna recepción pierde su
-- donante. FORCE RLS dejaría al UPDATE sin filas (no hay app.banco_id), así
-- que se suelta durante la limpieza y se restituye al final.

ALTER TABLE "inventario"."donante" NO FORCE ROW LEVEL SECURITY;

WITH repetidos AS (
    SELECT "id",
           row_number() OVER (
               PARTITION BY "banco_id", "tipo", lower("nombre")
               ORDER BY "creado_en", "id"
           ) AS n
    FROM "inventario"."donante"
    WHERE "activo"
)
UPDATE "inventario"."donante" d
SET "activo" = false,
    "actualizado_en" = CURRENT_TIMESTAMP
FROM repetidos r
WHERE d."id" = r."id" AND r.n > 1;

ALTER TABLE "inventario"."donante" FORCE ROW LEVEL SECURITY;

-- Prisma no expresa índices parciales sobre expresiones.
CREATE UNIQUE INDEX "donante_banco_id_tipo_nombre_activo_key"
    ON "inventario"."donante" ("banco_id", "tipo", lower("nombre"))
    WHERE "activo";

SELECT "core"."verificar_politicas_rls"();
