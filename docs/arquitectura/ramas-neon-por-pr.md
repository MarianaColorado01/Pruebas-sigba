# Ramas de Neon por pull request

En un PR de este repositorio que no sea de Dependabot, si `NEON_PROJECT_ID`
está definida, CI crea o reutiliza `preview/pr-<número>` desde la rama Neon
`staging`. Prisma aplica las migraciones con `neondb_owner`. Las pruebas de
integración se conectan como `sigba_app`, el rol de la API, sin `BYPASSRLS`, y
usan datos sintéticos. Al cerrar el PR, el workflow de limpieza borra solo la rama
con ese nombre.

En push a `main`, en un PR desde un fork (GitHub no le pasa secretos), en un PR
de Dependabot o mientras `NEON_PROJECT_ID` no esté configurada, el job `test`
usa el Postgres de servicio que levanta el propio job.

## Configuración de GitHub

Configura en GitHub Actions:

- El secreto `NEON_API_KEY`.
- La variable `NEON_PROJECT_ID`.
- La rama `staging` dentro del proyecto de Neon. La acción la usa como rama
  padre.

El proyecto de Neon es solo de staging: no tiene datos ni credenciales de
producción, y por eso su clave puede vivir en CI.

## Cómo elige CI la base

Un solo paso del job `test`, «Base de datos de las pruebas», escribe
`DATABASE_URL` y `API_DATABASE_URL` en el entorno; migraciones, pruebas y Nest
las leen de ahí. Con
Neon, antes de usar la URL comprueba que la acción la haya devuelto y consulta
por la API la rama correspondiente al `branch_id`. Solo usa la URL si el nombre
de esa rama es `preview/pr-<número>`.

El mismo paso genera con `openssl rand -hex 24` una clave aleatoria para
`sigba_app` y la pone en `API_DATABASE_URL`, que es `DATABASE_URL` con ese
usuario y esa clave. `test/rol-de-aplicacion.ts` aplica `db:roles` y fija la
clave al rol en cada corrida; en local, sin `API_DATABASE_URL`, usa
`prueba_aislamiento`.

La migración revoca `EXECUTE` de `core.registrar_auditoria` a `PUBLIC`. El
`GRANT EXECUTE` a `sigba_app` y el `SELECT` sobre `core.auditoria` viven en
`prisma/roles/rol-de-api.sql`, como el resto de sus privilegios
(ver [rol-de-api.md](rol-de-api.md)).

## Reproducir en local

1. Crea `preview/pr-<número>` desde `staging` en Neon, con el usuario dueño.
2. Exporta su URL PostgreSQL en `DATABASE_URL`.
3. Ejecuta `pnpm --filter @sigba/api exec prisma migrate deploy`.
4. Ejecuta `pnpm test`. El setup aplica `db:roles` y le pone clave a
   `sigba_app`; ambas credenciales apuntan a la rama de preview.

Usa solo datos sintéticos. No copies credenciales ni datos de producción a la
rama o al entorno local.

## Limpieza manual

En la consola de Neon, identifica `preview/pr-<número>` por el PR y elimina
solo esa rama. Comprueba el nombre antes de confirmar. CI hace esta misma
limpieza al recibir `pull_request.closed`, y termina sin error si la rama no
existe.

## Auditoría en módulos

Los módulos que incorporen escrituras de negocio deben llamar a
`AuditService.registrar` dentro de la misma transacción que modifica los datos.
Cada adaptador registra las filas que escribe. La migración instala triggers que
rechazan `UPDATE`, `DELETE` y `TRUNCATE` sobre `core.auditoria`. Quien puede
ejecutar DDL puede deshabilitarlos, y un superusuario puede omitirlos con
`session_replication_role`; por eso la API no debe conectarse como dueño.

`AuditoriaInterceptor` y `@AuditarLectura` ya no existen. Las lecturas todavía
no se auditan; esa implementación queda para el primer endpoint que necesite
registrarlas. `actor_id` aún no tiene una clave foránea a `plataforma.usuario`.
