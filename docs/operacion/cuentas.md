# Cuentas de operación

Registro de las cuentas de infraestructura de SIGBA
([SBA-10](https://linear.app/iuva/issue/SBA-10)), actualizado el 2026-10-22 con la
configuración de staging. No guarda contraseñas, tokens, client secrets, DSN ni cadenas
de conexión: esos valores viven en cada servicio y en los secretos de Fly.io y GitHub.

## Titular, acceso y recuperación

Las cinco cuentas de servicio están a nombre del correo institucional
`ingenieria@uam.edu.co` de la UAM. Camilo Agudelo administra ese buzón y es quien entra
hoy. El acceso a cualquiera de ellas se recupera desde el buzón: restablecer la contraseña
o pedir el enlace mágico.

Las cuentas personales que se usaron antes (las de Mariana Colorado y la cuenta Forjel de
Cloudflare) siguen abiertas hasta retirarlas ([pendientes.md](pendientes.md)).

| Servicio   | Uso                                  | Recurso                                                       | Titular                 | Plan         | Acceso         | Recuperación                         |
| ---------- | ------------------------------------ | ------------------------------------------------------------- | ----------------------- | ------------ | -------------- | ------------------------------------ |
| Fly.io     | API NestJS                           | Organización `sigba`, app `sigba-api-staging`                 | `ingenieria@uam.edu.co` | Pago por uso | Camilo Agudelo | Restablecer o enlace mágico al buzón |
| Neon       | PostgreSQL                           | Organización `org-little-union-07550543`, proyecto `sigba-db` | `ingenieria@uam.edu.co` | Gratuito     | Camilo Agudelo | Restablecer o enlace mágico al buzón |
| Cloudflare | DNS de `sigba.co` y Worker de la PWA | Cuenta «IUVA - Ingeniería»                                    | `ingenieria@uam.edu.co` | Gratuito     | Camilo Agudelo | Restablecer o enlace mágico al buzón |
| Auth0      | Identidad OIDC y emisión de JWT      | Tenant `sigba-staging.us.auth0.com`, región US                | `ingenieria@uam.edu.co` | Gratuito     | Camilo Agudelo | Restablecer o enlace mágico al buzón |
| Sentry     | Errores de la API                    | Organización `institucion-universitaria-visi`                 | `ingenieria@uam.edu.co` | Gratuito     | Camilo Agudelo | Restablecer o enlace mágico al buzón |

La tarjeta registrada en Fly.io está a nombre de Camilo Agudelo. Pasarla a un titular de
la universidad es un pendiente ([pendientes.md](pendientes.md)).

## Fly.io

- Organización `sigba`, nueva. La organización `personal` ya no se usa.
- App `sigba-api-staging` en la región `iad`, con una máquina.
- Secretos de la app: `API_DATABASE_URL`, `AUTH0_ISSUER_URL`, `AUTH0_AUDIENCE`,
  `CORS_ORIGINS`, `WEB_URL`, `SENTRY_DSN` y `SENTRY_ENVIRONMENT`.
- Dominio `api-staging.sigba.co`, con certificado emitido por Fly.io.

## Neon

- Proyecto `sigba-db` (`green-smoke-36405287`) en AWS `us-east-1`, Postgres 17.
- Ramas `production` (la de por defecto) y `staging`.
- En `staging` están aplicadas las migraciones y `db:roles`. El rol `sigba_app` tiene
  `LOGIN` y una contraseña aleatoria que solo está dentro del secreto `API_DATABASE_URL`
  de Fly.io ([rol-de-api.md](../arquitectura/rol-de-api.md)).
- Sin `NEON_API_KEY`: las ramas por PR están desactivadas. Si se activan, la clave va con
  alcance de proyecto, nunca la de organización
  ([ramas-neon-por-pr.md](../arquitectura/ramas-neon-por-pr.md)).

## Cloudflare

- Cuenta «IUVA - Ingeniería». Se administra con la CLI `cf`, nunca con wrangler.
- Zona `sigba.co` activa, solo DNS, con los nameservers `major.ns.cloudflare.com` y
  `megan.ns.cloudflare.com`.
- Worker `sigba-web-staging` con la PWA, en el dominio personalizado `staging.sigba.co`.

El dominio `sigba.co` sigue registrado en Vercel, en la cuenta «Scouts de Colombia»: la
compra y la renovación se hacen allí. Pasar el registro a un titular de la universidad es
un pendiente ([pendientes.md](pendientes.md)).

| Nombre                 | Uso                                                            |
| ---------------------- | -------------------------------------------------------------- |
| `staging.sigba.co`     | PWA de staging (Worker `sigba-web-staging`)                    |
| `api-staging.sigba.co` | API de staging: CNAME a `sigba-api-staging.fly.dev`, sin proxy |
| `app.sigba.co`         | PWA de producción, cuando exista                               |
| `api.sigba.co`         | API de producción, cuando exista                               |
| `sigba.co` y `www`     | Reservados para una landing futura, fuera del alcance de SIGBA |

## Auth0

- Tenant `sigba-staging.us.auth0.com`.
- API con identificador `https://api.sigba.uam.edu.co`: RS256, acceso offline y token de
  3600 s.
- Aplicación SPA «SIGBA PWA staging». Callbacks, logout y orígenes web:
  `http://localhost:5173`, `https://staging.sigba.co` y
  `https://sigba-web-staging.iuva-ingenieria.workers.dev`. Rotación de refresh token con
  vencimiento absoluto de 30 días y de 15 días sin uso.
- Action post-login «Correo en el access token»: agrega los claims
  `https://api.sigba.uam.edu.co/email` y `https://api.sigba.uam.edu.co/email_verified`
  ([auth0-setup.md](../arquitectura/auth0-setup.md)).
- Conexión `Username-Password-Authentication` habilitada para la SPA, con registro
  abierto.

## Sentry

- Proyecto `sigba-api` en la organización `institucion-universitaria-visi`.
- La API envía los errores por HTTP en formato envelope, sin el SDK (ADR-11), con
  `SENTRY_ENVIRONMENT=staging`.

## GitHub

Entorno `staging` del repositorio `MiloAgudelo/sigba`:

- Secretos: `CLOUDFLARE_API_TOKEN`, `FLY_API_TOKEN` y `STAGING_DATABASE_URL`.
- Variables: `CLOUDFLARE_ACCOUNT_ID`, `VITE_API_URL`
  (`https://api-staging.sigba.co/api/v1`), `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID` y
  `VITE_AUTH0_AUDIENCE`.

El workflow que los usa está en [despliegue.md](despliegue.md).
