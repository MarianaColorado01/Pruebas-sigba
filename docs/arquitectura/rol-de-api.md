# Rol de la API: `sigba_app`

La API se conecta a Postgres como `sigba_app`, un rol sin superusuario, sin
`BYPASSRLS` y sin `CREATEROLE` ni `CREATEDB` (ADR-07, Arquitectura 8.1). Un
superusuario se salta RLS y los GRANT: si la API conectara así, el aislamiento
entre bancos dependería solo de que cada consulta filtre bien.

Sus privilegios están en un solo archivo:
[`apps/api/prisma/roles/rol-de-api.sql`](../../apps/api/prisma/roles/rol-de-api.sql).
Se aplica con

```bash
pnpm --filter @sigba/api run db:roles
```

después de cada `prisma migrate deploy`, con la misma `DATABASE_URL` de las
migraciones (el dueño de las tablas). El script:

- crea `sigba_app` sin LOGIN si no existe, y falla si ya existe con atributos
  peligrosos, como miembro de otro rol o como dueño de tablas;
- le quita todo lo que tenga sobre los schemas de negocio y le concede lo que
  dice el archivo, tabla por tabla. Aplicarlo dos veces deja lo mismo, y borrar
  una línea quita el privilegio;
- no toca LOGIN ni la clave. La clave no entra en Git.

## Al añadir una tabla o una función

- **Tabla nueva:** su línea `GRANT` va en `rol-de-api.sql` en el mismo PR que
  la migración. Sin ella, las pruebas de integración que usan la tabla fallan
  en CI, porque se conectan como `sigba_app`. Una tabla que la API solo alcanza
  por una función `SECURITY DEFINER` no necesita línea. Ninguna tabla recibe
  `DELETE`, y una append-only no recibe `UPDATE` (ADR-08).
- **Función `SECURITY DEFINER`:** la migración hace
  `REVOKE ALL ON FUNCTION ... FROM PUBLIC` y no concede nada a `sigba_app`. El
  `GRANT EXECUTE ... TO sigba_app` va en la sección 4 del script.

## Local

`pnpm test` con `DATABASE_URL` apuntando al Postgres de `docker compose` lo
prepara solo: el `globalSetup` de vitest (`apps/api/test/rol-de-aplicacion.ts`)
aplica el script y le pone a `sigba_app` la clave de prueba
`prueba_aislamiento`. Las pruebas de integración se conectan con ese rol.

Corre `pnpm test` solo contra la base de `docker compose`. Contra otra base le
cambiaría la clave al `sigba_app` de verdad, además de borrar filas. Si hay
`API_DATABASE_URL`, la clave de prueba es la de esa URL; si no,
`prueba_aislamiento`.

`pnpm dev` conecta la API como `sigba_app` por `API_DATABASE_URL`, y las
migraciones y el seed como `sigba` por `DATABASE_URL`. La primera vez:

```bash
pnpm --filter @sigba/api exec prisma migrate deploy
pnpm --filter @sigba/api run db:roles
docker compose exec postgres psql -U sigba \
  -c "ALTER ROLE sigba_app LOGIN PASSWORD 'sigba_app_local'"
```

La clave es la de `API_DATABASE_URL` en `.env.example`.

Si tu base local tiene un rol `sigba_app_prueba` de corridas anteriores, puedes
borrarlo; ya no se usa.

## CI

El job `test` corre `migrate deploy`, luego `db:roles`, luego `pnpm test`, que
lo vuelve a aplicar en el `globalSetup` y otra vez en
`rol-de-api.integracion.spec.ts`. Cada corrida aplica el script tres veces sobre
la misma base.

La e2e que levanta `AppModule` se conecta como `sigba_app` por
`API_DATABASE_URL`. Usa el mismo `globalSetup` que las pruebas de integración,
así que el rol tiene LOGIN y la clave de esa URL aunque la e2e corra sola.

## Staging y producción (Neon)

El dueño del proyecto de Neon (el rol que corre las migraciones) hace esto una
vez por rama de base:

1. `prisma migrate deploy` y `db:roles` con la URL del dueño. El script crea
   `sigba_app`.
2. Desde `psql`, con la URL del dueño:
   `ALTER ROLE sigba_app LOGIN PASSWORD '<clave larga y aleatoria>'`. La clave
   va solo al secreto `API_DATABASE_URL` de Fly.io, nunca a Git; si se pierde,
   se genera otra con este mismo paso.
3. La API se conecta como `sigba_app` por `API_DATABASE_URL`, en los
   secretos de Fly.io. Las migraciones usan la URL del dueño en
   `DATABASE_URL`.

No crees `sigba_app` desde la consola de Neon: los roles creados ahí entran
como miembros de `neon_superuser` y heredan sus privilegios. El script lo
detecta y falla.

Después de cada despliegue con migraciones, `db:roles` corre otra vez con la
URL del dueño.
