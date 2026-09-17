# ADR-04 · TypeScript de extremo a extremo

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

La interfaz requiere TypeScript y el equipo tiene experiencia dispar. Go/Fiber o
Python/FastAPI o Django sumarían otro lenguaje y contratos entre ecosistemas,
sin una ventaja de rendimiento medida para el piloto.

## Decisión

Usar TypeScript estricto en NestJS y React.

JavaScript sin tipos reduce barreras iniciales, pero pierde la comprobación de
contratos que necesitan catorce desarrolladores. NestJS ofrece módulos e
inyección de dependencias; las reglas del repositorio deben reforzar esas
fronteras.

## Consecuencias

El equipo comparte tipos, pero valida entradas HTTP en ejecución: TypeScript no
valida JSON externo.

La plantilla de la Iteración 0 debe incluir DTO, pruebas y manejo de errores; la
planeación debe descontar aprendizaje.
