# Pendientes de operación

Lo que falta para operar staging, abrir producción y entregar la operación después del
26 de noviembre de 2026 (RF-M3-14). Cada punto tiene un responsable por nombrar salvo
que diga otro.

## Cuentas y accesos

- **Fly.io:** método de pago de verificación. Sin él no se despliega la API (SBA-7).
  Confirmar el plan en el panel ([cuentas.md](../SBA-10/cuentas.md)).
- **Fly.io:** crear la organización `sigba`. La organización personal no admite
  miembros, así que hoy solo Mariana Colorado puede operar la API.
- **Segundo administrador** en Auth0, Sentry, Cloudflare y Fly.io.
- **Cloudflare:** la PWA de staging se publica en la cuenta Forjel, que eligió Mariana
  Colorado. [cuentas.md](../SBA-10/cuentas.md) todavía lista la cuenta asociada a
  `MarianaColorado01` y habla de Pages; su dueño (SBA-10) tiene que actualizarlo. R2
  sigue sin cuenta definida [por verificar].
- **Correo institucional:** titular de las cinco cuentas. Las cuentas siguen siendo
  personales mientras no se defina (SBA-10). Alcance M3 asigna la titularidad a la
  universidad.
- **Almacén de 2FA y de secretos** del equipo: nombrarlo, sin guardar su contenido aquí.

## Secretos en GitHub

- Ramas de Neon por PR: secreto `NEON_API_KEY` y variable `NEON_PROJECT_ID`
  ([ramas-neon-por-pr.md](../arquitectura/ramas-neon-por-pr.md)).
- Entorno `staging`: `FLY_API_TOKEN`, `STAGING_DATABASE_URL`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `VITE_API_URL` y las tres `VITE_AUTH0_*`
  ([despliegue.md](despliegue.md)).

## Auth0

- Tenant y aplicación SPA de staging, con el origen exacto del Worker
  `sigba-web-staging` en callbacks, logout y web origins.
- Action que agrega el correo verificado al access token, desplegada y probada
  ([auth0-setup.md](../arquitectura/auth0-setup.md)).

## Respaldos y llaves

- Ventana de historial de Neon en el plan Gratuito [por verificar].
- Dónde se guardan los volcados diarios cifrados y quién guarda la llave
  ([respaldos.md](respaldos.md)).
- Repetir la prueba de restauración en una rama de Neon.
- Custodia y rotación de llaves (SBA-31, [custodia-de-llaves.md](custodia-de-llaves.md)).
- Logs, alertas y Sentry (SBA-83).

## Repositorio privado

El monorepo es personal y privado; la custodia personal no cambia la autoría del equipo
ni la titularidad institucional de los servicios (Alcance M3).

- **Custodio del repositorio:** por nombrar.
- **Copia del repositorio:** quién la tiene, dónde y cada cuánto se actualiza. Una copia
  con `git clone --mirror` conserva ramas y etiquetas; los issues están en Linear y no
  viajan con ella.
- Acceso de lectura para quien opere después de la entrega.

## Presupuesto y continuidad

**Presupuesto de seis meses.** $1.300.000 COP, de septiembre de 2026 a febrero de 2027
(Alcance M1, M2 y M3, sección de costo y cuentas). El desglose por servicio está en
[04_Presupuesto_SIGBA.pdf](../04_Presupuesto_SIGBA.pdf) [por verificar: no se transcribió
para este documento].

Consumo esperado en staging [por verificar contra las facturas]:

| Servicio   | Plan                  | Costo                                                   |
| ---------- | --------------------- | ------------------------------------------------------- |
| Fly.io     | Hobby (sin confirmar) | Una máquina `shared-cpu-1x` de 512 MB siempre encendida |
| Neon       | Gratuito              | Sin costo dentro de los límites del plan                |
| Cloudflare | Gratuito              | Sin costo dentro de los límites de Workers              |
| Auth0      | Gratuito              | Sin costo dentro del límite de usuarios activos         |
| Sentry     | Developer (gratuito)  | Sin costo dentro del límite de eventos                  |
| CodeRabbit | Un asiento pagado     | Mensual ([CONTRIBUTING.md](../CONTRIBUTING.md))         |

Revisar el consumo de cada panel una vez al mes y anotarlo aquí.

**Continuidad después de febrero de 2027.** Sin financiación ni responsable definidos.
Alcance M3 lo deja a cargo del equipo con la universidad, titular de las cuentas. Hay que
decidir:

- Quién paga Fly.io y los planes que excedan el nivel gratuito.
- Quién opera: despliegues, respaldos, restauraciones y rotación de llaves.
- Quién da soporte al Banco de Alimentos de Pereira y con qué horario.
- Qué pasa con los datos si nadie asume la operación: exportarlos para el Banco y borrar
  las cuentas, con fecha.
