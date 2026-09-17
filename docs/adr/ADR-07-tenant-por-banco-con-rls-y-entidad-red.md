# ADR-07 · Tenant por banco con RLS desde la Iteración 0 y entidad red

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

Cada banco necesita aislamiento y el portal maneja datos personales. Un filtro
solo en la API depende de que cada consulta lo aplique. La red prevista no
autoriza cruces nominales entre bancos.

## Decisión

`banco_id` en tablas operativas y RLS desde la Iteración 0. La API resuelve
banco y permisos en SIGBA, fija el contexto dentro de la transacción y usa un
rol sin privilegios de elusión.

`USING` y `WITH CHECK` cubren lecturas y escrituras; `FORCE RLS` protege frente
al rol propietario cuando corresponda. Las entidades globales red, rol y usuario
tienen permisos propios [F11].

## Consecuencias

Una base por banco ofrece una barrera distinta, pero multiplica migraciones y
operación. Aplazar RLS aumenta el riesgo de introducir tablas sin política.

RLS no protege ante un superusuario, una función privilegiada insegura o un
contexto incorrecto: CI debe probar esos límites.

La entidad red no habilita consultas nominales entre bancos.
