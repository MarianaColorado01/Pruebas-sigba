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

## Nota del 15 de octubre de 2026: tablas globales (SBA-61)

Los permisos propios de las entidades globales quedan así:

- `red` y `rol` no tienen RLS. Son catálogos sin `banco_id` ni datos
  personales: la red ABACO y los roles de Arquitectura 8.2. La API los lee con
  `GRANT SELECT` y solo escribe en ellos con una línea explícita en
  `rol-de-api.sql`.
- `banco` tiene RLS forzada (SBA-19). Cualquiera lee su nombre y código; solo
  escribe `super_admin`, con `app.banco_id` igual al banco escrito (D7).
- `usuario` tiene RLS forzada. La API ve la fila propia (`app.usuario_id`) y
  la de quien tenga una asignación activa en `app.banco_id`. Una persona que
  solo está en el banco B no aparece para el banco A.
- Las cuatro están en el registro `core.tabla_global`, con su control
  (`catalogo` o `rls`) y su razón. `core.verificar_politicas_rls()` lo lee:
  una tabla de negocio sin `banco_id` que no esté registrada hace fallar la
  migración, igual que una registrada como `rls` sin RLS forzada y política, o
  una que dé privilegios a `PUBLIC`.
- Una tabla global nueva entra al registro con un `INSERT` en la migración que
  la crea, y cambiar su control es un `UPDATE`; la función no se toca. Así
  pasó `banco` de `catalogo` a `rls` en SBA-19.
