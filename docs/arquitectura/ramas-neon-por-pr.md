# Ramas de Neon por pull request

CI crea o reutiliza `preview/pr-<número>` desde la rama Neon `staging`. Prisma
aplica las migraciones con `neondb_owner`. Las pruebas se conectan como
`sigba_app_prueba`, un rol sin `BYPASSRLS`, y usan datos sintéticos. Al cerrar
el PR, CI borra solo la rama con ese nombre.

## Configuración de GitHub

Configura en GitHub Actions:

- El secreto `NEON_API_KEY`.
- La variable `NEON_PROJECT_ID`.
- La rama `staging` dentro del proyecto de Neon. La acción la usa como rama
  padre y la crea para el PR; el job falla si la acción no devuelve una URL de
  conexión de preview.

El repositorio no contiene estos valores y no confirma si ya existen en los
ajustes de GitHub. El job no recibe credenciales de producción.

La acción oficial `neondatabase/create-branch-action@v6` devuelve la URL del
rol dueño para `migrate deploy`. El test de integración crea el rol de pruebas
sin `BYPASSRLS`; `API_DATABASE_URL` dirige el arranque de Nest a ese rol. La
acción `neondatabase/delete-branch-action@v3` limpia la rama al cerrar el PR,
con o sin merge.

El repositorio aún no define el rol productivo de ejecución de la API ni sus
GRANT. La única configuración de roles está en el setup de pruebas, que crea
`sigba_app_prueba` sin `BYPASSRLS`. Antes de desplegar la API con acceso a la
auditoría, el equipo debe definir ese rol y sus privilegios. Esta iteración no
crea un rol nuevo.

## Reproducir en local

1. Crea `preview/pr-<número>` desde `staging` en Neon, con el usuario dueño.
2. Exporta su URL PostgreSQL en `DATABASE_URL`.
3. Ejecuta `pnpm --filter @sigba/api exec prisma migrate deploy`.
4. Ejecuta `pnpm test`. El setup prepara `sigba_app_prueba` para las pruebas;
   ambas credenciales apuntan a la rama de preview.

Usa solo datos sintéticos. No copies credenciales ni datos de producción a la
rama o al entorno local.

## Limpieza manual

En la consola de Neon, identifica `preview/pr-<número>` por el PR y elimina
solo esa rama. Comprueba el nombre antes de confirmar. CI realiza esta misma
limpieza al recibir el evento `pull_request.closed`.

## Auditoría en módulos

Los módulos que incorporen escrituras de negocio deben llamar a
`AuditService.registrar` dentro de la misma transacción que modifica los datos.
La migración de auditoría no instala triggers ni extensiones de Prisma; cada
adaptador registra las filas que escribe.

El interceptor de lecturas registra en una transacción propia después de que
termina el handler y antes de entregar la respuesta. La atomicidad con la
lectura queda pendiente hasta que `core` exponga la transacción de la petición.
