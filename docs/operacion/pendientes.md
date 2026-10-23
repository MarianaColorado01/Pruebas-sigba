# Pendientes de operación

Lo que falta para operar staging, abrir producción y entregar la operación después del
26 de noviembre de 2026 (RF-M3-14). Cada punto tiene un responsable por nombrar salvo
que diga otro.

## Cuentas y accesos

Las cuentas ya están a nombre de `ingenieria@uam.edu.co` ([cuentas.md](cuentas.md)).
Queda abierto:

- **Cuentas personales:** retirar las de Mariana Colorado y la cuenta Forjel de
  Cloudflare, que se usaron antes de las institucionales.
- **Origen `workers.dev`:** quitar `https://sigba-web-staging.iuva-ingenieria.workers.dev`
  de la SPA de Auth0 y de `CORS_ORIGINS` cuando `staging.sigba.co` sea el único origen.
- **Producción:** `app.sigba.co` (PWA) y `api.sigba.co` (API) todavía no existen.
- **Neon:** si se activan las ramas por PR, crear `NEON_API_KEY` con alcance de proyecto,
  no la de organización, y la variable `NEON_PROJECT_ID`
  ([ramas-neon-por-pr.md](../arquitectura/ramas-neon-por-pr.md)).
- **Titular universitario de la tarjeta y el dominio:** la tarjeta de Fly.io está a
  nombre de Camilo Agudelo y `sigba.co` está registrado en la cuenta de Vercel «Scouts de
  Colombia». Los dos pasan a un titular de la universidad, para que no dependan de una
  persona ni de una organización externa.

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

| Servicio   | Plan              | Costo                                                   |
| ---------- | ----------------- | ------------------------------------------------------- |
| Fly.io     | Pago por uso      | Una máquina `shared-cpu-1x` de 512 MB siempre encendida |
| Neon       | Gratuito          | Sin costo dentro de los límites del plan                |
| Cloudflare | Gratuito          | Sin costo dentro de los límites de Workers              |
| Auth0      | Gratuito          | Sin costo dentro del límite de usuarios activos         |
| Sentry     | Gratuito          | Sin costo dentro del límite de eventos                  |
| CodeRabbit | Un asiento pagado | Mensual ([CONTRIBUTING.md](../CONTRIBUTING.md))         |

Revisar el consumo de cada panel una vez al mes y anotarlo aquí.

**Continuidad después de febrero de 2027.** Sin financiación ni responsable definidos.
Alcance M3 lo deja a cargo del equipo con la universidad, titular de las cuentas. Hay que
decidir:

- Quién paga Fly.io, hoy con la tarjeta de Camilo Agudelo, y los planes que
  excedan el nivel gratuito.
- Quién opera: despliegues, respaldos, restauraciones y rotación de llaves.
- Quién da soporte al Banco de Alimentos de Pereira y con qué horario.
- Qué pasa con los datos si nadie asume la operación: exportarlos para el Banco y borrar
  las cuentas, con fecha.
