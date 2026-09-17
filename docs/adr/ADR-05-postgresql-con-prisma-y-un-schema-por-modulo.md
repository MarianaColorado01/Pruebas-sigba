# ADR-05 · PostgreSQL con Prisma y un schema por módulo

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

Inventario y membresías requieren relaciones y transacciones. PostgreSQL aporta
RLS. MySQL/MariaDB cubre el modelo relacional, pero exige otra estrategia de
aislamiento; MongoDB exige justificar un modelo documental que este dominio no
necesita.

## Decisión

PostgreSQL con Prisma y schemas `core`, `plataforma`, `inventario`,
`beneficiarios` y `analitica`. Cada módulo escribe sus tablas.

Las referencias entre schemas usan identificadores y el servicio dueño las
valida, sin FK cruzadas. Funciones acotadas insertan auditoría y outbox dentro
de la transacción del dominio, sin conceder modificación general de `core`.

## Consecuencias

Una base por módulo elevaría el costo operativo y separaría transacciones.

Sin FK cruzadas, el equipo controla desactivaciones y referencias huérfanas.

El diseño exige probar clientes Prisma, roles, RLS y funciones en una misma
transacción; la aceptación no sustituye esa prueba.
