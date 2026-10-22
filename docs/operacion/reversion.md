# Revertir un despliegue

Un despliegue fallido se revierte en dos tiempos:

1. **Rápido:** devolver Fly.io o Cloudflare a la versión anterior, sin esperar a CI.
2. **Definitivo:** revertir el commit en `main` por PR. Si no se hace, el siguiente
   despliegue vuelve a publicar la versión mala.

Antes de empezar, avisa en el canal del equipo qué se revierte y por qué.

## API en Fly.io

Cada `flyctl deploy` crea una release con su imagen en `registry.fly.io`.

1. Lista las releases y sus imágenes:

   ```bash
   flyctl releases --app sigba-api-staging --image
   ```

   [por verificar: el flag `--image`, que agrega la columna con la referencia de la
   imagen.] Ubica la última release estable, anterior a la fallida.

2. Despliega esa imagen sin reconstruir:

   ```bash
   flyctl deploy --app sigba-api-staging --config apps/api/fly.toml \
     --image registry.fly.io/sigba-api-staging:<etiqueta-de-la-release-anterior>
   ```

   Corre el comando desde la raíz del repositorio para que lea `apps/api/fly.toml`.
   [por verificar: cuántas imágenes conserva el registro de Fly.io para una app.]

3. Comprueba: `curl -fsS https://sigba-api-staging.fly.dev/api/v1/health` y
   `flyctl status --app sigba-api-staging`.

4. Abre un PR con `git revert <commit>` del cambio que falló y mézclalo. El workflow
   despliega la reversión.

No hace falta tocar secretos ni la base: la imagen anterior arranca con los mismos
secretos y tolera el esquema nuevo, porque las migraciones solo agregan.

## PWA en Cloudflare

Cada `cf deploy` crea una versión del Worker `sigba-web-staging` y la despliega al 100 %.
Volver atrás es crear un despliegue que mande todo el tráfico a la versión anterior.
Estos comandos salen de `cf cli search` y `--help` de `cf@1.0.0-beta.20`; no se han
ejecutado contra la cuenta Forjel [por verificar].

```bash
export CLOUDFLARE_API_TOKEN=<token>   # el mismo del entorno staging
export CLOUDFLARE_ACCOUNT_ID=<id de Forjel>

# 1. Versiones y despliegues recientes
pnpm dlx cf@1.0.0-beta.20 workers versions list --worker-id sigba-web-staging
pnpm dlx cf@1.0.0-beta.20 workers deployments list --worker sigba-web-staging

# 2. Ensayo: muestra la petición sin ejecutarla
pnpm dlx cf@1.0.0-beta.20 workers deployments create --worker sigba-web-staging \
  --strategy percentage \
  --versions '[{"version_id":"<id de la versión anterior>","percentage":100}]' \
  --dry-run

# 3. El mismo comando sin --dry-run
```

Después, revierte el commit en `main` como con la API.

La PWA registra el service worker con `registerType: 'prompt'`: quien ya cargó la versión
mala ve el aviso de actualización y pasa a la restaurada al aceptarlo [por verificar en
un navegador con la PWA instalada]. Los comandos en la cola offline no se pierden con el
cambio de versión (ADR-10).

## Migraciones: el esquema no se revierte

- No se deshace una migración aplicada ni se edita su archivo. Prisma la registra en
  `_prisma_migrations` y `migrate deploy` falla si cambia.
- Si una migración dejó algo mal, se corrige con una migración nueva hacia adelante, por
  PR, como cualquier cambio.
- Si `migrate deploy` falla a mitad, el job `api` se detiene antes de publicar la imagen:
  la versión anterior sigue en pie. Corrige con una migración nueva; si Prisma marca la
  fallida, resuélvela con `prisma migrate resolve` según la documentación de Prisma
  [por verificar: procedimiento con Neon].
- Restaurar la base ([respaldos.md](respaldos.md)) es solo para pérdida o corrupción de
  datos, nunca para deshacer un despliegue: borra lo registrado después del punto
  elegido.
