# Contraste del esquema M2 v3.2 con la documentación del repositorio

2026-09-24 · sobre `origin/main` en `8b942fb`

Compara [esquema_beneficiarios.md](esquema_beneficiarios.md) con lo que el repositorio
ya da por decidido:

- Documento de Arquitectura v1.2 ([docs/01_Arquitectura_SIGBA.pdf](../01_Arquitectura_SIGBA.pdf)).
- Alcance M2 v1.2 ([docs/02_Alcance_M2_Beneficiarios.pdf](../02_Alcance_M2_Beneficiarios.pdf)).
- ADR-05, ADR-07 y ADR-14 en [docs/adr/](../adr/).
- `AGENTS.md` y [docs/CONTRIBUTING.md](../CONTRIBUTING.md).
- El código de `core/database` y las migraciones de `apps/api/prisma/`.
- El texto de SBA-26, SBA-31 y SBA-48 tal como está hoy en Linear.

Cada hallazgo lleva un número (C-NN) y una de tres marcas:

- **Bloquea**: contradice una decisión aceptada o no se puede implementar como está
  escrito.
- **Decidir**: el esquema y la fuente dicen cosas distintas y cualquiera de las dos
  puede ser la correcta. Alguien tiene que elegir y dejarlo escrito.
- **Ajuste**: corrección de cita, de redacción o de implementación que no cambia el
  diseño.

El texto de cada hallazgo describe la versión 3.2 y se conserva como se escribió. Los autores del esquema y quien revise pueden refutar el hallazgo o la forma en que lo atiende la versión 5.0; el [README](README.md) dice cómo.

«Huella» es el nombre que Arquitectura 8.6 y el Anexo B dan al HMAC del documento por banco. No es un dato biométrico; la sección 9 del esquema lo explica.

## Resumen

Todos los hallazgos se contrastaron contra la versión 3.2. La columna _Estado_ dice cómo los atiende la versión 5.0 del esquema; ninguno pasa por cerrado mientras no se revise el PR.

| #    | Marca   | Tema                                                            | Estado en la versión 5.0                                                                                              |
| ---- | ------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| C-01 | Bloquea | Documento en claro frente a cifrado y huella HMAC               | Diferido: en claro mientras haya datos sintéticos; cifrado y HMAC antes del primer dato real (D40, SBA-31)            |
| C-02 | Decidir | Unicidad por `(banco, número)` frente a `(banco, tipo, número)` | Decidido: se mantiene D2 con UNIQUE `(banco_id, numero_documento)`; ADR-15 registra que se aparta de RF-M2-06         |
| C-03 | Bloquea | Permisos por rol de PostgreSQL con un único rol de conexión     | Decidido: D26 entra con el portal (SBA-44 y SBA-45), corregido por D41                                                |
| C-04 | Ajuste  | `app.usuario_id` no se fija hoy en la transacción               | Atendido: `core` fija `app.usuario_id` desde SBA-18                                                                   |
| C-05 | Decidir | Contexto ausente: excepción frente a cero filas                 | Decidido: A y B usan `current_setting`, como main (D42); la excepción de D27 se decide con el portal                  |
| C-06 | Decidir | Reglas de dominio en funciones `SECURITY DEFINER`               | Decidido: D28, opción 1; las funciones entran con el portal (D41)                                                     |
| C-07 | Ajuste  | La verificación de RLS ya existe en `core`                      | Atendido: cada migración llama a `core.verificar_politicas_rls()` y las pruebas comprueban FORCE por tabla            |
| C-08 | Ajuste  | Lo que Prisma no expresa va en SQL a mano                       | Atendido: convención de la sección 4 del esquema                                                                      |
| C-09 | Ajuste  | `persona` entra y `representante` sale del Anexo B              | Atendido: ADR-15; el Anexo B queda en pendientes                                                                      |
| C-10 | Decidir | Evento nuevo `AlertaDuplicidadAbierta` y descarte sin evento    | Decidido: D31, con `estado` en la carga; contrato para SBA-30                                                         |
| C-11 | Decidir | Actor en tablas operativas                                      | Decidido: D3 se mantiene, salvo `institucion` (D29); lo registra ADR-15                                               |
| C-12 | Ajuste  | La sección de auditoría que D3 marca como falta                 | Atendido: D3 cita Anexo B, 5.2, 8.6, RNF-04 y SBA-21                                                                  |
| C-13 | Ajuste  | D10 cita ADR-01; la regla es de ADR-05                          | Atendido: D10                                                                                                         |
| C-14 | Ajuste  | El lint no restringe lo que `inventario` importa del `index.ts` | Atendido: sección 7 del esquema                                                                                       |
| C-15 | Decidir | Soporte del consentimiento opcional y guardado como URL         | Decidido: se guarda la clave del objeto; NULL hasta que exista el almacén y NOT NULL antes del primer dato real (D43) |
| C-16 | Decidir | Autorización del menor dentro del consentimiento de la persona  | Decidido: tabla `consentimiento` append-only (D25)                                                                    |
| C-17 | Decidir | Supresión y anonimización sin camino en el esquema              | Diferido: `suprimir_persona` pasa a los controles antes del primer dato real (D44). Los plazos siguen con Cáritas     |
| C-18 | Decidir | `intento_registro` no registra la entidad consultada            | Decidido: `core.auditoria` (D24); `intento_registro` entra con SBA-46, sin `persona_id`                               |
| C-19 | Ajuste  | Revisión del catálogo `tipo_poblacion`                          | Atendido: nota en la sección 5.2 del esquema y pendiente con Cáritas                                                  |
| C-20 | Decidir | SBA-26 pide auditar el cambio de contacto y depende de SBA-21   | Decidido: `actualizado_por` y `actualizado_en` (D29)                                                                  |
| C-21 | Ajuste  | D8 remite a SBA-16, que no trata de instituciones               | Apunte en D8 y pendiente en la sección 11 del esquema                                                                 |
| C-22 | Ajuste  | §7.3 cita el criterio 2 de SBA-48 para otra regla               | Apunte en las secciones 7 y 8.4 del esquema; `motivo_fin_detalle` salió el 2026-09-28                                 |

## 1. Contra decisiones aceptadas

### C-01 · Bloquea · Documento en claro (D18)

El esquema guarda `documento_numero` en claro y deja la protección a RLS y privilegios.
Cuatro fuentes piden lo contrario:

- Arquitectura 8.6, fila _Cifrado_: «cifrado del documento por columna y huella HMAC
  por banco para búsqueda, con llaves fuera de la base. El diseño queda aceptado».
- Arquitectura, Anexo B: «Beneficiario: documento cifrado y huella HMAC por banco;
  unicidad por banco, tipo y huella».
- Alcance M2, RNF-M2-06, con la métrica «El hash simple no satisface el diseño».
- SBA-31: sus tres criterios. Un volcado de la tabla no deja leer el documento, el
  mismo documento en dos bancos da huellas distintas y una rotación de llave conserva
  legibles los registros anteriores. La nota del ticket fija la salida de la deuda en la
  Iteración 1, que termina el 30 de septiembre.

`AGENTS.md` lo repite como invariante: «documento cifrado y huella HMAC por banco».

El aislamiento entre bancos y la protección de datos personales es el atributo de
prioridad 1 (Arquitectura 1.2). RLS no cubre los casos que SBA-31 quiere cubrir: un
volcado, una copia de respaldo de Neon, una rama de Neon por PR o un rol con
`BYPASSRLS`. ADR-07 lo dice en sus consecuencias: «RLS no protege ante un superusuario».
Con D18, cualquier copia de la base expone el número de documento de población
vulnerable, menores incluidos.

**Propuesta.** Volver al diseño de la versión 3.1 para `persona`:

| Columna                   | Tipo    | Nota                                                                                         |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `documento_cifrado`       | `bytea` | Cifrado en la API con llave fuera de la base.                                                |
| `documento_llave_version` | `int`   | Necesario para el criterio 3 de SBA-31 (rotación).                                           |
| `documento_huella`        | `bytea` | HMAC con llave por banco sobre el número normalizado. UNIQUE `(banco_id, documento_huella)`. |

Esto no obliga a deshacer D2: la huella puede calcularse solo sobre el número, y la
unicidad `(banco_id, documento_huella)` conserva el paso de `ti` a `cc` en la misma
fila. El CHECK de normalización pasa a una prueba sobre la función que normaliza antes
de calcular la huella. El cifrado va detrás de un puerto de `core` con el adaptador en
`repositories/` (RNF-03); ningún service importa la librería de cifrado.

Si el equipo sostiene D18, el camino no es «actualizar SBA-31». Hace falta un ADR nuevo
que reemplace la fila _Cifrado_ de 8.6, firmado por los tres capitanes, y el visto bueno
de Cáritas como responsable del tratamiento.

Nota menor: el criterio 1 de SBA-31 habla de «la tabla beneficiario». Con D1 el
documento vive en `persona`, así que el ticket debería decir `persona`.

### C-02 · Decidir · Unicidad sin tipo de documento (D2)

El esquema declara que se aparta de SBA-15. También se aparta del Alcance M2, RF-M2-06
(«unicidad del beneficiario por (banco, tipo de documento, número)»), y del Anexo B
(«unicidad por banco, tipo y huella»).

El argumento del esquema se sostiene: la tarjeta de identidad y la cédula comparten
número y con `(tipo, número)` la persona se parte en dos filas al cumplir 18. El riesgo
que acepta (colisión entre tipos) ya está en §5.3 como pendiente con Cáritas.

**Propuesta.** Si se acepta D2, actualizar RF-M2-06 en el Alcance y la nota del Anexo B
en el mismo movimiento que SBA-15, y dejar escrito quién aceptó el riesgo de colisión.

## 2. Supuestos que el código de hoy no cumple

### C-03 · Bloquea · Un rol de PostgreSQL para toda la API (§7.3, D17)

§7.3 da políticas distintas a `admin_banco`, `coordinacion` e `institucion`, y D17 usa
`GRANT UPDATE (columnas)` para limitar lo que edita `institucion`. Eso supone un rol de
PostgreSQL por rol de aplicación.

Las pruebas de aislamiento modelan la API como un solo rol sin privilegios de elusión
([apps/api/test/rol-de-aplicacion.ts:33](../../apps/api/test/rol-de-aplicacion.ts),
`NOSUPERUSER NOBYPASSRLS`) y distingue sesiones solo por `app.banco_id` y
`app.institucion_id`
([prisma-rls.extension.ts:23](../../apps/api/src/core/database/prisma-rls.extension.ts)).
Con un solo rol, un `GRANT` por columna vale igual para coordinación que para una
institución, y una política no sabe qué rol de aplicación está actuando.

`registrar_beneficiario` tiene el mismo problema: debe verificar «el rol de la sesión, no
`current_user`», y hoy la sesión no lleva rol.

**Opciones.**

1. `SET LOCAL ROLE` al inicio de cada transacción hacia roles `NOLOGIN` (`app_institucion`,
   `app_coordinacion`…) de los que el rol de conexión es miembro. Mantiene D17 tal cual.
2. Fijar `app.rol` con `set_config` y leerlo en las políticas. D17 deja de poder
   hacerse con `GRANT` y pasa a un trigger o a una función `SECURITY DEFINER`.

Las dos tocan `core/database`, que tiene CODEOWNER. La decisión es de arquitectura y
afecta también a `plataforma` e `inventario`.

### C-04 · Ajuste · `app.usuario_id` (D16)

`TenantContext` ya tiene `usuarioId` y `rol`
([tenant-context.ts](../../apps/api/src/core/database/tenant-context.ts)), pero
`fijarContexto` solo fija banco e institución. D16 necesita una tercera línea en `core`,
con revisión de arquitectura. Si C-03 se resuelve con la opción 2, entra también
`app.rol`.

### C-05 · Decidir · Contexto ausente (§7.1)

`beneficiarios.banco_id()` lanza una excepción si no hay contexto. Las políticas de
`plataforma` e `inventario` usan `NULLIF(current_setting('app.banco_id', true), '')::uuid`,
que sin contexto deja la consulta en cero filas, y `fijarContexto` escribe cadena vacía
cuando falta el banco. Las dos formas cumplen Arquitectura 8.1 («rechazan contexto
ausente»). La excepción hace visible el error de una tarea de fondo, que es lo que pide
SBA-45.

**Propuesta.** Si se adopta la excepción, definir las tres funciones en `core` para que
las usen todos los schemas, en vez de que `beneficiarios` tenga un comportamiento propio.

### C-06 · Decidir · Reglas de dominio en `SECURITY DEFINER` (D11, D20, §7.2, §8)

`registrar_beneficiario`, `activar_membresia` y `cerrar_membresia` contienen las reglas de
SBA-28, SBA-32, SBA-47 y SBA-48: menor sin representante, duplicidad, traslado y
descarte de alertas. Tres fuentes las ubican en otro lugar:

- `AGENTS.md` y RNF-02: el dominio va en `services/`, con TDD, y la cobertura del 70 %
  se mide ahí. El PL/pgSQL no entra en esa métrica ni en las pruebas unitarias.
- Arquitectura 6.4: `BeneficiariosService` resuelve unicidad y duplicidad.
- Arquitectura 5.2, _Escrituras_: auditoría y outbox se insertan con funciones acotadas
  de `core` dentro de la transacción de negocio. Si la regla vive en la función, la
  función tiene que llamar esas funciones de `core`, o devolver lo necesario para que el
  service escriba auditoría y outbox con el mismo cliente.

ADR-07 advierte que RLS no protege ante «una función privilegiada insegura». Con
`FORCE ROW LEVEL SECURITY`, el dueño de la función también pasa por RLS, así que las
políticas tienen que admitir al dueño o la función no ve las filas.

D11 resuelve un problema real: una política de INSERT no puede exigir una membresía que
todavía no existe.

**Opciones.**

1. Funciones mínimas: solo el INSERT que necesita privilegio. Menor, duplicidad y
   traslado quedan en services con TDD.
2. Mantener §7.2 y aceptar por escrito que esas reglas se prueban con pruebas de
   integración contra PostgreSQL, fuera de la métrica del 70 %.

### C-07 · Ajuste · Verificación de RLS (§7.4)

La primera prueba de §7.4 ya existe como `core.verificar_politicas_rls()`
([migración inicial, línea 179](../../apps/api/prisma/migrations/20260917000000_init_plataforma_rls/migration.sql)),
que cada migración ejecuta al final. No revisa `relforcerowsecurity` ni que las FKs
incluyan `banco_id`. Conviene extender esa función en vez de escribir una prueba
paralela.

### C-08 · Ajuste · Lo que Prisma no expresa (§5)

Prisma no declara índices únicos parciales, CHECK ni columnas `GENERATED`. Van en el
`migration.sql` escrito a mano, y en `schema.prisma` `membresia.estado` queda como campo
que la aplicación no escribe. Las FKs compuestas sí se expresan
(`@relation(fields: [beneficiarioId, bancoId], references: [personaId, bancoId])` con
`@@unique([personaId, bancoId])`).

## 3. Anexo B y contratos

### C-09 · Ajuste · `persona` y `representante` (D1)

El Anexo B lista `beneficiario`, `representante` y `representacion`, y Arquitectura 5.2
habla de «representantes». El esquema crea `persona` y quita `representante`. El Alcance
M2 ya nombra `persona` en el plan de la Iteración 0 y Arquitectura 8.6 dice que el
representante no necesita ser beneficiario, así que D1 encaja con las dos. Falta
actualizar el Anexo B.

### C-10 · Decidir · Eventos (§8)

Arquitectura 5.2 y RF-M2-15 declaran tres eventos: `MembresiaActivada`,
`MembresiaCerrada` y `AlertaDuplicidadResuelta`. El esquema añade
`AlertaDuplicidadAbierta`. Arquitectura 8.5 deja pendiente «apertura de alertas», así que
el evento tiene sitio, pero es un cambio de contrato: va en `packages/shared-types` con
revisión de arquitectura y de M3 (Arquitectura 5.2) y llega con SBA-30.

Además, una alerta descartada emite `AlertaDuplicidadResuelta` con `resolucion = null`.
El consumidor no distingue una resolución de coordinación de un cierre automático sin
mirar un campo nulo. Un campo `estado` en la carga, o un evento propio, lo haría
explícito.

### C-11 · Decidir · Actor en tablas operativas (D3)

El Anexo B dice: «Las tablas operativas incluyen banco_id y actor o tarea del sistema».
D3 delega el actor en la auditoría transversal. `tipo_poblacion`, `institucion`,
`beneficiario` y `representacion` quedan sin actor. `plataforma` sí lleva `creado_por`,
como `VARCHAR(100)`; el esquema usa `uuid` en sus columnas `*_por`, que coincide con
`plataforma.usuario.id`.

**Opciones.** Aceptar D3 y pedir el cambio del Anexo B, o añadir `creado_por` a esas
cuatro tablas.

### C-12 · Ajuste · La sección de auditoría que falta (D3)

D3 pide el número de sección que define la auditoría transversal. Está repartido:

- Anexo B: `core.auditoria`.
- Arquitectura 5.2, _Reglas de frontera · Escrituras_: inserción acotada dentro de la
  transacción de negocio.
- Arquitectura 8.6, fila _Acceso_: qué registra.
- RNF-04: actor, banco y fecha en toda escritura.
- Ticket: SBA-21 ([core/README.md](../../apps/api/src/core/README.md)).

### C-13 · Ajuste · Cita de D10

La regla «sin FK entre schemas» es de ADR-05 y de Arquitectura 5.2, _Referencias_.
ADR-01 trata del monolito modular.

### C-14 · Ajuste · Qué hace el lint (§8, última fila)

«Regla ESLint de fronteras bloquea cualquier otro import desde `inventario`» no es
exacto. El lint exige entrar por `index.ts`; no limita qué módulo funcional importa a
cuál (`AGENTS.md`, _Lo que el lint no restringe_). Lo que limita a M1 es que
`beneficiarios/index.ts` exporte solo `InstitucionesService`.

## 4. Datos personales

### C-15 · Decidir · Soporte del consentimiento (§5.3)

`consentimiento_soporte_url` admite NULL. Arquitectura 8.6 dice «Marcar una casilla no
sustituye el soporte», y RF-M2-13 pide conservar la evidencia. Si la columna es
opcional, el sistema acepta el caso que 8.6 descarta.

Además, los objetos de R2 son privados y se leen con URLs firmadas de corta duración
(Arquitectura 3.2 y 5.1). Una URL guardada caduca; lo que se guarda es la clave del
objeto (`consentimiento_soporte_clave`).

**Propuesta.** NOT NULL para el soporte, salvo que Cáritas apruebe otra evidencia, y
guardar la clave del objeto.

### C-16 · Decidir · Autorización del menor (D15)

Arquitectura 8.6, fila _Menores_: «Registrar su vínculo y autorización por separado».
D15 quita `representacion.autorizacion_fecha` y deja la evidencia en
`persona.consentimiento_*`. Si el representante cambia (`cambio_representante`), el
consentimiento se sobrescribe en `persona` y la autorización anterior queda solo en la
auditoría, que por 8.6 no copia datos personales.

**Opciones.** Guardar la autorización en `representacion`, o llevar el consentimiento a
una tabla append-only con una fila por otorgamiento.

### C-17 · Decidir · Supresión y retención (§7.3)

RF-M2-14 (Could) y Arquitectura 8.6, fila _Retención_, piden un procedimiento
verificable de supresión o anonimización antes de datos reales, y la Ley 1581 da al
titular el derecho de supresión. §7.3 prohíbe DELETE para todos los roles y el esquema no
tiene función ni columna para anonimizar.

**Propuesta.** Una función `anonimizar_persona` para `coordinacion` y `admin_banco` que
sobrescriba los datos personales y conserve las filas para los conteos, o dejarlo como
pendiente explícito en §10.

### C-18 · Decidir · Entidad consultada (D19)

Arquitectura 8.6, fila _Acceso_: la auditoría registra «actor, finalidad operativa,
entidad consultada, fecha y resultado». `intento_registro` no guarda qué se consultó.
D19 lo justifica porque sin huella habría que guardar el número en claro. Si C-01 se
resuelve con huella, `intento_registro` puede guardar `persona_id` cuando el resultado
es `persona_existente` o `duplicidad`, sin datos personales. También puede quedar en
`core.auditoria`.

### C-19 · Ajuste · Catálogo `tipo_poblacion` (§5.1)

RNF-M2-07 y Arquitectura 8.6, fila _Minimización_: el catálogo no admite inferencias de
salud, religión ni pertenencia étnica sin revisar finalidad y base. §5.1 deja el
catálogo a `coordinacion` sin esa revisión. Basta una nota en §5.1 y el visto bueno de
Cáritas sobre la lista inicial.

## 5. Contra los tickets de Linear

### C-20 · Decidir · Auditoría del contacto de una institución (SBA-26, D3)

El criterio 2 de SBA-26 pide que un cambio de contacto quede en auditoría «con quién y
cuándo». Por D3, `institucion` no lleva actor ni fecha y confía en la auditoría
transversal, que llega con SBA-21. SBA-26 y SBA-21 son de la Iteración 1; si SBA-21 se
retrasa, SBA-26 no puede cerrar su criterio 2.

**Opciones.** Ordenar SBA-21 antes que SBA-26 en la iteración, o añadir
`actualizado_por` y `actualizado_en` a `institucion` como en C-11.

### C-21 · Ajuste · D8 remite a SBA-16

D8 dice «Confirmar en SBA-16». SBA-16 acuerda con Cáritas los campos de la persona, el
consentimiento y la política de tratamiento; no trata de instituciones. El singular de
«tipo de población atendida» ya viene de SBA-26. Si hay que confirmarlo, es con
coordinación del Banco, dentro de SBA-26.

### C-22 · Ajuste · Criterio 2 de SBA-48 (§7.3, D20)

§7.3 cita «SBA-48 crit. 2» para la regla de que `cerrar_membresia` rechaza membresías de
otra institución. El criterio 2 dice otra cosa: si una encargada intenta mover a una
persona a otra institución, la API responde 403. El esquema lo cubre por otro camino
(`institucion` no tiene UPDATE sobre `membresia` y `cerrar_membresia` rechaza
`motivo_fin = traslado` con contexto de institución), pero la base responde con una
excepción. El service tiene que traducirla a 403, no dejar que llegue como 500. Lo mismo
vale para el criterio 3 (retiro sin motivo): conviene que el DTO lo rechace antes de
llegar a la base.

SBA-48 no pide detalle cuando el motivo es `otro`; el CHECK de `motivo_fin_detalle` lo
exige. Es un requisito que el esquema añade, y SBA-48 puede recogerlo o el CHECK puede
salir.

**Atendido el 2026-09-28:** salen `motivo_fin_detalle` y su CHECK. El enum
`motivo_fin_membresia`, con `otro`, cumple SBA-48, y un texto libre obligatorio sobre por
qué una persona dejó la institución recogía datos de salud y de riesgo sin control.

### SBA-16 queda para después

SBA-16 depende de la respuesta de Cáritas y no se contrasta ahora. Cuando llegue el
acuerdo, su criterio («el modelo de `beneficiario` no tiene campos fuera de la lista
acordada») se revisa contra `persona`, que es donde D1 deja esos campos. La lista del
ticket no incluye los campos de consentimiento; lo que decida Cáritas sobre ellos
también afecta a C-15 y C-16.

## 6. Lo que coincide

- `banco_id`, RLS habilitado y forzado en todas las tablas (ADR-07, Arquitectura 8.1).
- FKs dentro del schema con `banco_id` (Arquitectura 5.2, _Referencias_); D14 lo cumple
  al pie de la letra.
- Sin FK hacia usuarios de `plataforma` (ADR-05).
- Una sola membresía activa con índice único parcial (RA-03, RF-M2-07).
- Respuesta de duplicidad sin identificar a la otra institución (RNF-M2-05,
  Arquitectura 6.4).
- Límite de intentos para frenar la enumeración (Arquitectura 6.4, SBA-46).
- Traslado solo por `coordinacion` o `admin_banco`, en una transacción; retiro propio
  con motivo (Arquitectura 8.2, RF-M2-10).
- El representante no necesita ser beneficiario (RF-M2-05).
- `beneficiarios` no escribe inventario (ADR-14).
- Institución inactiva sin borrado (ADR-14, consecuencias).
- Rango etario calculado y no almacenado; los rangos viven en `parametro_banco`
  (Arquitectura 8.7).
- Consentimiento con fecha, finalidad, versión del aviso y responsable (Alcance S2.3).
- `institucion` con los campos de SBA-26. El contacto se parte en nombre, teléfono y
  correo, y `direccion` se añade; el correo lo usa la invitación de SBA-44.
- `motivo_fin_membresia` con los cuatro motivos de SBA-48 más `traslado`, reservado a
  coordinación. La membresía retirada se conserva y volver a registrar crea una fila
  nueva (SBA-48, criterio 1).

## 7. Pendientes que añade este contraste

Se suman a los de la sección 11 del esquema:

- Escribir `docs/operacion/llaves.md` y ejecutar la prueba de recuperación antes del 30
  de septiembre (cierre de la Iteración 1 y salida de la deuda de SBA-31). La versión 5.0
  lo pasa a antes del primer dato real (D40).
- Revisar con arquitectura D26 y D27, que cambian `core/database` para todos los módulos.
- Actualizar RF-M2-06 del Alcance y el Anexo B de Arquitectura si se aceptan D1 y D2.
- Llevar `AlertaDuplicidadAbierta` a SBA-30 como cambio de contrato.
- Confirmar con Cáritas el soporte obligatorio del consentimiento, la autorización del
  menor y el procedimiento de supresión.
