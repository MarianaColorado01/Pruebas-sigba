# Imagen de la API para Fly.io (ADR-11, SBA-7). Se construye desde la raíz del
# monorepo para que pnpm vea el lockfile y los paquetes del workspace:
#
#   docker build -f apps/api/Dockerfile -t sigba-api .
#
# La imagen no corre migraciones ni tiene la URL del dueño de las tablas: eso
# lo hace el workflow de despliegue antes de publicarla. La API arranca con
# API_DATABASE_URL, el rol sigba_app sin BYPASSRLS (Arquitectura 8.1).

FROM node:24-slim AS base
# Prisma detecta la versión de OpenSSL al generar y al cargar el motor: las dos
# etapas tienen que ver la misma.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @sigba/api...
RUN pnpm --filter @sigba/api... run build
# Copia la API con sus dependencias de producción, sin enlaces al workspace.
RUN pnpm --filter @sigba/api deploy --prod --legacy /app
# El cliente de Prisma se genera dentro de node_modules; el de /repo no viaja
# con el deploy.
RUN cd /app && /repo/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

FROM base
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
