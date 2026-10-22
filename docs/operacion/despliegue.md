# Despliegue a staging

El workflow «Despliegue a staging» (`.github/workflows/despliegue.yml`, de SBA-7) publica
la API en Fly.io y la PWA en Cloudflare cada vez que CI termina en verde sobre `main`.
También se lanza a mano. Mientras falten los secretos de un lado, ese job se salta con un
aviso en el resumen y el workflow termina en verde.

## Qué hace cada job

**`api`**, con la URL del dueño de las tablas en `DATABASE_URL`:

1. `pnpm --filter @sigba/api exec prisma migrate deploy`
2. `pnpm --filter @sigba/api run db:roles`
3. `flyctl deploy . --config apps/api/fly.toml --dockerfile apps/api/Dockerfile --remote-only`
4. `curl -fsS --retry 5 --retry-all-errors https://sigba-api-staging.fly.dev/api/v1/health`

**`web`**: construye la PWA con las variables `VITE_*` y la publica como Worker de solo
assets `sigba-web-staging` con `pnpm dlx cf@1.0.0-beta.20 deploy --prebuilt`. Las rutas
desconocidas responden `index.html` (`notFoundHandling: single-page-application`).

Las migraciones corren antes de la imagen nueva y la versión anterior sigue atendiendo
mientras Fly.io cambia de máquina. Por eso cada migración solo agrega (expandir y
después contraer): una columna se borra en un despliegue posterior, cuando ningún código
en pie la usa. Esta regla también permite revertir la API sin tocar el esquema
([reversion.md](reversion.md)).

## Configuración de la primera vez

Se hace una vez por ambiente. Ningún valor secreto entra a Git ni a este documento.

### 1. Neon: rama `staging` y rol de la API

1. En el proyecto `sigba-db`, crea la rama `staging` si no existe. Es también la rama
   padre de las ramas de PR ([ramas-neon-por-pr.md](../arquitectura/ramas-neon-por-pr.md)).
2. Copia la URL directa (sin pooler) del rol dueño, `neondb_owner`, sobre la base
   `neondb`. Esa URL es `STAGING_DATABASE_URL` y solo vive en GitHub [por verificar: si
   Prisma necesita la URL directa o tolera la del pooler para `migrate deploy`].
3. Con esa URL, aplica migraciones y rol:

   ```bash
   export DATABASE_URL='<url del dueño>'
   pnpm --filter @sigba/api exec prisma migrate deploy
   pnpm --filter @sigba/api run db:roles
   psql "$DATABASE_URL" -c "ALTER ROLE sigba_app LOGIN"
   psql "$DATABASE_URL"
   ```

   Dentro de `psql`, `\password sigba_app` pide la clave dos veces sin mostrarla y la
   manda cifrada, así no queda en el historial de la terminal ni en el de `psql`. La
   clave sale de `openssl rand -hex 24` y va al gestor de secretos del equipo y a
   Fly.io. No crees `sigba_app` desde la consola de Neon: entraría como miembro de
   `neon_superuser` y `db:roles` falla ([rol-de-api.md](../arquitectura/rol-de-api.md)).

4. Arma `API_DATABASE_URL` con el mismo host y base, usuario `sigba_app` y esa clave.

### 2. Fly.io: app y secretos

Requiere el método de pago de verificación en la cuenta ([pendientes.md](pendientes.md)).

```bash
flyctl auth login
flyctl apps create sigba-api-staging --org personal
```

La organización pasa a `sigba` cuando exista. Carga los secretos desde la entrada
estándar para que no queden en el historial de la terminal:

```bash
flyctl secrets import --app sigba-api-staging --stage <<'FIN'
API_DATABASE_URL=postgresql://sigba_app:<clave>@<host-de-neon>/neondb?sslmode=require
AUTH0_ISSUER_URL=https://<tenant>.us.auth0.com/
AUTH0_AUDIENCE=<identifier de la API en Auth0>
CORS_ORIGINS=https://sigba-web-staging.<subdominio>.workers.dev
WEB_URL=https://sigba-web-staging.<subdominio>.workers.dev
SENTRY_DSN=<DSN del proyecto de la API en Sentry>
SENTRY_ENVIRONMENT=staging
FIN
```

`--stage` guarda los secretos sin reiniciar máquinas; el primer despliegue los toma
[por verificar: que `secrets import` acepte `--stage`].
`SMTP_URL` y `CORREO_REMITENTE` son opcionales: sin ellos la PWA muestra el enlace de
invitación para copiarlo. `SENTRY_DSN` también es opcional: sin él los errores 5xx solo
quedan en el log de Fly.io. Con él, `SENTRY_ENVIRONMENT` es obligatoria y la API no
arranca si falta (SBA-83). `STAGING_DATABASE_URL` nunca entra a Fly.io: la API se conecta
como `sigba_app`, sin `BYPASSRLS`.

El origen exacto del Worker se conoce tras el primer despliegue de la PWA
[por verificar: subdominio `workers.dev` de la cuenta Forjel]. Hasta entonces deja
`CORS_ORIGINS` y `WEB_URL` con un valor provisional y corrígelos después.

Token para GitHub, limitado a la app:

```bash
flyctl tokens create deploy --app sigba-api-staging
```

[por verificar: vigencia por defecto del token y si conviene fijar `--expiry`.]

### 3. Cloudflare: token de la PWA

En la cuenta Forjel, crea un token de API con el permiso **Account › Workers Scripts ›
Edit** limitado a esa cuenta [por verificar: si `cf deploy --prebuilt` necesita algún
permiso más]. Anota el Account ID.

### 4. Auth0

La aplicación SPA de staging necesita el origen exacto del Worker en Allowed Callback
URLs, Allowed Logout URLs y Allowed Web Origins, sin comodines
([auth0-setup.md](../arquitectura/auth0-setup.md)).

### 5. GitHub: entorno `staging`

En Settings › Environments, crea `staging`. En **Deployment branches and tags** elige
**Selected branches and tags** y agrega solo `main`: así ningún job de otra rama recibe
los secretos de staging, aunque alguien cambie el workflow en su rama. Después carga:

| Tipo     | Nombre                  | Valor                                      |
| -------- | ----------------------- | ------------------------------------------ |
| Secreto  | `FLY_API_TOKEN`         | Token de despliegue de Fly.io              |
| Secreto  | `STAGING_DATABASE_URL`  | URL del dueño de la rama `staging` de Neon |
| Secreto  | `CLOUDFLARE_API_TOKEN`  | Token de Workers de la cuenta Forjel       |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Account ID de Forjel                       |
| Variable | `VITE_API_URL`          | `https://sigba-api-staging.fly.dev/api/v1` |
| Variable | `VITE_AUTH0_DOMAIN`     | Dominio del tenant, sin `https://`         |
| Variable | `VITE_AUTH0_CLIENT_ID`  | Client ID de la SPA                        |
| Variable | `VITE_AUTH0_AUDIENCE`   | El mismo identifier de `AUTH0_AUDIENCE`    |

Las `VITE_*` son públicas: terminan en el JavaScript que descarga el navegador. Con la
CLI de GitHub:

```bash
gh secret set FLY_API_TOKEN --env staging
gh variable set VITE_API_URL --env staging --body https://sigba-api-staging.fly.dev/api/v1
```

`gh secret set` sin `--body` pide el valor por la terminal.

## Despliegue de rutina

Mezclar un PR a `main`. CI corre sobre el push y, si termina en verde, el workflow
despliega ese mismo commit. Dos despliegues no corren a la vez y uno en curso no se
cancela.

## Despliegue manual

En GitHub, Actions › «Despliegue a staging» › Run workflow, sobre `main`. Con la CLI:

```bash
gh workflow run despliegue.yml --ref main
```

El despliegue manual publica la punta de `main`. No sirve para volver a una versión
anterior: para eso está [reversion.md](reversion.md).

## Comprobar que funcionó

1. En Actions, los jobs `api` y `web` en verde. Si uno dice «sin desplegar», le faltan
   secretos.
2. `curl -fsS https://sigba-api-staging.fly.dev/api/v1/health` responde 200.
3. `flyctl status --app sigba-api-staging`: una máquina en `started` con los checks en
   `passing`.
4. Abrir la PWA, iniciar sesión con un usuario sintético y cargar una pantalla que llame
   a la API con rol (por ejemplo, el selector de banco).
5. Si hubo migraciones: `flyctl logs --app sigba-api-staging` sin errores de Prisma.

Logs centralizados y alertas llegan con SBA-83.
