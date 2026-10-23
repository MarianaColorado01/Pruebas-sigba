# Operación de SIGBA

Cómo se despliega SIGBA, cómo se revierte un despliegue, cómo se respalda y restaura
la base y qué falta de las cuentas para operarlo (SBA-84, RF-M3-14, RNF-M3-05).

| Documento                                      | Para qué                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| [cuentas.md](cuentas.md)                       | Titular, plan, acceso y recuperación de cada cuenta              |
| [despliegue.md](despliegue.md)                 | Configurar staging la primera vez y desplegar                    |
| [reversion.md](reversion.md)                   | Volver a la versión anterior de la API o de la PWA               |
| [respaldos.md](respaldos.md)                   | Respaldar y restaurar la base; prueba de restauración del 21 oct |
| [custodia-de-llaves.md](custodia-de-llaves.md) | Llaves de cifrado y HMAC de SBA-31 (pendiente)                   |
| [pendientes.md](pendientes.md)                 | Lo que falta de cuentas, accesos, presupuesto y continuidad      |

## Quién opera

Opera el Equipo 3 (`plataforma` y `analitica`), con Mariana Colorado como capitana
(@MarianaColorado01). Las cuentas de los servicios están a nombre del correo institucional
`ingenieria@uam.edu.co` de la UAM ([cuentas.md](cuentas.md)).

El custodio del repositorio privado y el responsable de operación después de la entrega
del 26 de noviembre de 2026 están sin nombrar. Ver [pendientes.md](pendientes.md).

## Ambientes

| Ambiente   | API                                                                   | Base de datos                                                          | PWA                                                          |
| ---------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| Local      | `pnpm dev`, puerto 3000                                               | Postgres 16 de `docker compose`                                        | Vite en `http://localhost:5173`                              |
| CI         | Nest dentro del job `test`                                            | Postgres de servicio, o rama Neon `preview/pr-<n>` si está configurada | Solo `pnpm build`                                            |
| Staging    | `api-staging.sigba.co`, app `sigba-api-staging` de Fly.io, región iad | Neon, proyecto `sigba-db`, rama `staging`, AWS `us-east-1`             | `staging.sigba.co`, Worker de Cloudflare `sigba-web-staging` |
| Producción | No existe todavía; será `api.sigba.co`                                | No existe todavía                                                      | No existe todavía; será `app.sigba.co`                       |

Los ambientes de hoy usan solo datos sintéticos (Arquitectura 7.1). Producción tendrá datos
personales de beneficiarios: antes de crearla hay que cerrar SBA-31 y decidir dónde se
guardan los respaldos ([respaldos.md](respaldos.md)).

## Disponibilidad (RNF-M3-05)

La meta es 99 % mensual entre las 6:00 y las 20:00: unas 4 horas de caída al mes en ese
horario. Durante una caída de la API la PWA sigue registrando en su cola local y
sincroniza al volver (ADR-10). Los respaldos son diarios y la restauración se prueba.

Logs, alertas y Sentry son de SBA-83, todavía en curso: este directorio los enlazará
cuando cierre.

## Referencias

- [ADR-11](../adr/ADR-11-fly-neon-cloudflare-sin-sdk-de-proveedor.md): Fly.io, Neon y
  Cloudflare.
- [rol-de-api.md](../arquitectura/rol-de-api.md): el rol `sigba_app` y su clave.
- [ramas-neon-por-pr.md](../arquitectura/ramas-neon-por-pr.md): ramas de Neon en CI.
- [auth0-setup.md](../arquitectura/auth0-setup.md): tenant y aplicación de Auth0.
- `.github/workflows/despliegue.yml`: el workflow «Despliegue a staging» (SBA-7).
