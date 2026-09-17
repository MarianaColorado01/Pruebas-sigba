# ADR-11 · Fly.io, Neon y Cloudflare sin SDK de proveedor

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

El stack acordado incluye Fly.io, Neon, Cloudflare Pages y R2. El piloto
necesita costo controlado y un responsable de operación tras la entrega.

## Decisión

Desplegar NestJS y tareas en contenedor en Fly.io, PostgreSQL en Neon, PWA en
Pages y objetos privados en R2 por API S3. **Los adaptadores contienen las
dependencias del proveedor.**

AKS añade un clúster que el piloto no necesita. Azure Container Apps merece
comparar operación y costo, pero no hay un crédito institucional confirmado para
este proyecto. La revisión no declara a Render más caro sin cotizarlo.

## Consecuencias

Fly.io evita gestionar parte del sistema anfitrión; el equipo sigue a cargo de
dependencias, migraciones, secretos y recuperación.

Una VM con soporte institucional sigue como alternativa.

Migrar exige probar datos, archivos, DNS, identidad y tareas, no solo cambiar
URLs.

Verificar regiones, cuotas y restauración con el presupuesto de seis meses y
cuentas institucionales. El soporte posterior sigue abierto.
