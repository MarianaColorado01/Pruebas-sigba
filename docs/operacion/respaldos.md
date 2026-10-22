# Respaldos y restauración

RNF-M3-05 pide respaldos diarios con restauración probada. SIGBA tiene dos capas:

1. **Historial de Neon (restauración a un punto en el tiempo).** Viene con el plan y no
   requiere trabajo.
2. **Volcado lógico diario con `pg_dump`.** Es una propuesta: falta decidir dónde se
   guarda.

Una restauración se da por buena cuando la base restaurada pasa `migrate deploy` sin
migraciones pendientes, `db:roles` y la prueba de aislamiento entre bancos.

## Historial de Neon

Neon guarda el historial de cambios de cada rama durante una ventana que depende del
plan. Dentro de esa ventana se puede crear una rama desde un instante pasado o restaurar
una rama a ese instante.

- Plan en uso: Gratuito ([cuentas.md](../SBA-10/cuentas.md)).
- Ventana de historial del plan Gratuito: [por verificar en el panel de Neon, Settings ›
  Storage]. Si es de horas, no alcanza para la meta de respaldos diarios y el volcado
  lógico deja de ser opcional.
- La ventana es configurable dentro del límite del plan [por verificar].

Para recuperar datos, crea primero una rama nueva desde el instante anterior al
problema, sin tocar `staging`. En la consola: Branches › Create branch, rama padre
`staging`, opción de un punto pasado en el tiempo [por verificar: nombre exacto de la
opción en la consola actual]. Valida esa rama con los pasos de abajo y solo entonces
decide si reemplaza a `staging`.

## Volcado lógico diario (propuesta)

Un job programado corre una vez al día:

```bash
pg_dump "$DATABASE_URL" -Fc -f sigba-$(date -u +%F).dump
```

- `-Fc` es el formato custom: comprimido y restaurable por tablas con `pg_restore`.
- `DATABASE_URL` es la URL directa del dueño (`STAGING_DATABASE_URL`). `pg_dump` tiene que
  ser de la misma versión mayor de Postgres que Neon o más nueva [por verificar: versión
  del proyecto `sigba-db`].
- El volcado se cifra antes de salir del runner, por ejemplo con `age` y una llave
  pública cuya llave privada guarda el custodio.

**Dónde se guarda: decisión pendiente.** Condiciones:

- Privado y cifrado. En producción contendrá datos personales de beneficiarios, con el
  documento cifrado y su HMAC por banco (SBA-31). El cifrado del archivo protege el
  resto: nombres, direcciones y datos de menores.
- En una cuenta institucional, no personal.
- No en artefactos de GitHub Actions: cualquiera con lectura del repositorio los
  descarga y no hay control de retención por archivo.
- Retención definida (por ejemplo 30 días) y borrado automático.

Candidato: un bucket privado de R2 en la cuenta institucional de Cloudflare, con
retención por regla de ciclo de vida [por verificar costo y la regla]. Mientras staging
tenga solo datos sintéticos, el volcado no es urgente; antes de producción sí.

## Restaurar desde un volcado

El orden importa. El volcado trae las tablas, las políticas RLS, los `GRANT` y el dueño
de cada función, pero no los roles: esos son del clúster. Tres roles tienen que existir
antes de `pg_restore`:

| Rol                        | Lo crea                                                | Por qué hace falta antes                                             |
| -------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `sigba_identity_lookup`    | migración `20261001090000_auth0_identity`              | Es dueño de `plataforma.resolver_usuario_auth0` (`SECURITY DEFINER`) |
| `sigba_super_admin_lookup` | migración `20261017130000_plataforma_bancos_y_bodegas` | Es dueño de `plataforma.actua_como_super_admin` (`SECURITY DEFINER`) |
| `sigba_app`                | `db:roles`                                             | Los `GRANT` del volcado lo nombran                                   |

`migrate deploy` no los vuelve a crear: con el historial restaurado no tiene migraciones
pendientes. Sin los roles, `pg_restore` reporta errores y deja las funciones
`SECURITY DEFINER` con el dueño equivocado (ver la prueba).

No uses `pg_restore --no-owner`. Le pasa todas las funciones al usuario que restaura; en
local ese usuario es superusuario y las funciones `SECURITY DEFINER` correrían sin RLS.

El dueño de la base destino tiene que llamarse igual que el de la base original
(`neondb_owner` en Neon): las políticas `*_administracion` se crearon `TO` ese rol.

Pasos, con `DATABASE_URL` apuntando a la base destino vacía y como su dueño:

```bash
# 1. Roles del clúster, con los atributos de las migraciones y de rol-de-api.sql.
#    Si ya existen en el clúster, sáltate este paso.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE sigba_identity_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS" \
  -c "CREATE ROLE sigba_super_admin_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS" \
  -c "CREATE ROLE sigba_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB"

# 2. Restaurar, deteniéndose en el primer error.
pg_restore -d "$DATABASE_URL" --exit-on-error sigba-AAAA-MM-DD.dump

# 3. Debe decir «No pending migrations to apply».
pnpm --filter @sigba/api exec prisma migrate deploy

# 4. Reaplicar los privilegios de la API.
pnpm --filter @sigba/api run db:roles

# 5. Clave de sigba_app: la del gestor de secretos, la misma de API_DATABASE_URL en Fly.io.
#    Dentro de psql, \password sigba_app la pide sin mostrarla ni dejarla en el historial.
psql "$DATABASE_URL" -c "ALTER ROLE sigba_app LOGIN"
psql "$DATABASE_URL"

# 6. Funciones SECURITY DEFINER con su dueño correcto.
psql "$DATABASE_URL" -c "SELECT p.proname, pg_get_userbyid(p.proowner)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef AND n.nspname = 'plataforma'"
```

En Neon el dueño no es superusuario. Que pueda asignar funciones a
`sigba_identity_lookup` y `sigba_super_admin_lookup` durante `pg_restore` está
[por verificar] en una rama de prueba.

Después, compara conteos de filas con el origen y corre la prueba de aislamiento sobre
una copia (paso 7 de la prueba de abajo). `globalSetup` cambia la clave de `sigba_app`:
no lo corras sobre la base que va a usar la API, o vuelve a fijar la clave del paso 5 al
terminar ([rol-de-api.md](../arquitectura/rol-de-api.md)).

Si la base restaurada reemplaza a la de staging, actualiza `API_DATABASE_URL` en Fly.io
y `STAGING_DATABASE_URL` en GitHub cuando cambie el host.

## Prueba de restauración

**Fecha:** 21 de octubre de 2026. **Commit:** `17f019b` (`main`). **Dónde:** máquina de
desarrollo con Windows 11 y Docker. Postgres 16.15
(`postgres:16-alpine`), datos sintéticos.

Se usaron dos clústeres para que la restauración no encontrara los roles ya creados:
origen en el puerto 55412 y destino, vacío, en el 55413.

1. **Origen.** `prisma migrate deploy` aplicó las 20 migraciones y `db:roles` terminó con
   «Script executed successfully».

2. **Datos sintéticos.** `prisma db seed` falla en `main`: el `upsert` de `producto` usa
   la llave `bancoId_nombre`, que el esquema ya no tiene (la unicidad es ahora
   `(banco_id, normalizar(nombre))`). La semilla alcanzó a crear el banco sintético. Se
   agregaron por SQL, con `set_config('app.banco_id', ..., true)` en cada transacción, un
   segundo banco, dos usuarios con su asignación, tres bodegas, tres categorías y cuatro
   productos.

3. **Volcado.**

   ```bash
   docker exec sigba-pg-f-restore pg_dump -U sigba -d sigba -Fc -f /tmp/sigba.dump
   ```

   Archivo de 141 042 bytes.

4. **Restauración sin crear los roles (control).** `pg_restore` sobre una base vacía del
   clúster destino terminó con «errors ignored on restore: 50», todos `role ... does not
exist`. `resolver_usuario_auth0` y `actua_como_super_admin`, las dos funciones
   `SECURITY DEFINER` que deben pertenecer a roles sin privilegios, quedaron con dueño
   `sigba`, el superusuario. Esa base se borró.

5. **Restauración con el procedimiento de arriba.**

   ```bash
   createdb -U sigba sigba_restaurada
   psql -U sigba -d sigba_restaurada -v ON_ERROR_STOP=1 \
     -c "CREATE ROLE sigba_identity_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS" \
     -c "CREATE ROLE sigba_super_admin_lookup NOLOGIN NOSUPERUSER NOBYPASSRLS" \
     -c "CREATE ROLE sigba_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB"
   pg_restore -U sigba -d sigba_restaurada --exit-on-error /tmp/sigba.dump   # salida 0
   ```

   Dueños: `resolver_usuario_auth0` → `sigba_identity_lookup`, `actua_como_super_admin` →
   `sigba_super_admin_lookup`, `aceptar_invitacion` → `sigba`, igual que en el origen.

6. **Migraciones, rol y clave**, con
   `DATABASE_URL=postgresql://sigba:sigba@localhost:55413/sigba_restaurada`:

   ```bash
   pnpm --filter @sigba/api exec prisma migrate deploy   # No pending migrations to apply.
   pnpm --filter @sigba/api run db:roles                 # Script executed successfully.
   psql -U sigba -d sigba_restaurada -c "ALTER ROLE sigba_app LOGIN PASSWORD 'prueba_aislamiento'"
   ```

   Conteos, con el superusuario:

   | Tabla                       | Origen | Restaurada |
   | --------------------------- | -----: | ---------: |
   | `plataforma.red`            |      1 |          1 |
   | `plataforma.banco`          |      2 |          2 |
   | `plataforma.rol`            |      7 |          7 |
   | `plataforma.usuario`        |      2 |          2 |
   | `plataforma.usuario_rol`    |      2 |          2 |
   | `plataforma.bodega`         |      3 |          3 |
   | `inventario.categoria`      |      3 |          3 |
   | `inventario.producto`       |      4 |          4 |
   | `core.tabla_global`         |      4 |          4 |
   | `public._prisma_migrations` |     20 |         20 |

   Como `sigba_app`: sin contexto de banco, `plataforma.bodega` devuelve 0 filas; con
   `app.banco_id` del primer banco, 2 bodegas y 3 productos, solo los suyos.

7. **Aislamiento** sobre la base restaurada:

   ```bash
   DATABASE_URL=postgresql://sigba:sigba@localhost:55413/sigba_restaurada \
     pnpm --filter @sigba/api exec vitest run \
     test/aislamiento.integracion.spec.ts \
     test/rol-de-api.integracion.spec.ts \
     test/tablas-globales.integracion.spec.ts
   ```

   Resultado: 3 archivos y 24 pruebas aprobadas, ninguna omitida. Esas pruebas se saltan
   sin `DATABASE_URL`; aquí corrieron. `globalSetup` aplicó `db:roles` otra vez.

Al terminar se borraron los dos contenedores y el volcado.

**Lo que esta prueba no cubre:** restaurar en Neon, donde el dueño no es superusuario;
el historial de Neon; y un volcado tomado de staging. Repetirla en una rama de Neon
cuando existan las credenciales de staging, y después cada mes con un volcado real del
job diario.
