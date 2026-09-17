# ADR-03 · Monorepo con pnpm

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

Los tres equipos comparten contratos entre React y NestJS y entregan una
plataforma. Los capitanes acordaron un repositorio con pnpm.

## Decisión

Usar un repositorio personal privado con pnpm workspaces: `apps/api`, `apps/web`
y paquetes compartidos. El equipo elige esa custodia por las limitaciones
encontradas con CODEOWNERS y despliegues en cuentas institucionales. Los
servicios de infraestructura mantienen cuentas institucionales.

Repositorios por equipo exigirían publicar contratos entre entregas.

## Consecuencias

El PR cambia contrato y consumidores juntos.

CODEOWNERS usa revisores individuales y requiere GitHub Pro para el repositorio
privado; el equipo verifica el plan y protege `main` [F18].

La cuenta personal concentra propiedad y recuperación, por lo que el equipo
documenta custodia y copia institucional [F20].

La release mantiene dos aprobaciones sin presuponer required reviewers privados
en Pro [F19].
