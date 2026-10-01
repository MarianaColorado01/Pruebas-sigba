# ADR-15 · Persona normalizada en beneficiarios, con documento cifrado y HMAC por banco antes del primer dato real

- **Estado:** propuesto
- **Fecha:** 24 de septiembre de 2026; ajustado el 29 de septiembre de 2026
- **Autores:** Juan David Gaitán y Julián Hinestroza (Equipo 1); ajuste de Camilo Agudelo, responsable de arquitectura
- **Fuente:** esquema M2 v5.0 en [docs/SBA-15](../SBA-15/README.md), SBA-15 y SBA-31

## Contexto

El Anexo B de Arquitectura modela `beneficiario` con el documento cifrado y la
«huella HMAC» (un código con llave, explicado abajo), `representante` aparte y
`representacion` entre los dos. RF-M2-06 pide unicidad por banco, tipo de
documento y número. Al bajar ese modelo a tablas aparecieron tres problemas:

1. Una misma persona puede ser beneficiaria y representar a un menor. Con
   `beneficiario` y `representante` como tablas distintas, sus datos
   personales quedan en dos filas, sin forma de cruzarlas.
2. En Colombia la tarjeta de identidad y la cédula que la persona recibe a los
   18 años tienen el mismo número. Con la unicidad por `(tipo, número)`, ese
   cambio parte a la persona en dos filas y rompe la regla de una membresía
   activa.
3. Con el consentimiento en columnas de la persona, un cambio de representante
   sobrescribe la autorización anterior. Arquitectura 8.6 pide registrar la
   autorización del menor por separado y conservar su soporte.

Arquitectura 8.6, el Anexo B, RNF-M2-06 y SBA-31 piden además el documento
cifrado por columna y una «huella HMAC» por banco. Ese HMAC no es un dato
biométrico: es un código que la API calcula a partir del número con una llave
secreta del banco. El mismo número da siempre el mismo código, así que la base
puede buscar a la persona y rechazar un segundo registro sin guardar el número
legible, y en otro banco el mismo número da otro código. En este esquema la
columna se llama `documento_hmac`. RLS no protege un volcado, un respaldo ni
una rama de Neon (ADR-07), y por eso el cifrado es obligatorio con datos
reales.

Hasta que Cáritas cierre SBA-16 la base solo tiene datos sintéticos, y una
copia de esa base no expone a nadie. Cifrar desde la primera migración exigía
un puerto de `core`, custodia de llaves y un procedimiento de rotación, con
SBA-31 sin rama ni PR, y bloqueaba SBA-27 y SBA-28 antes de la demo del 1 de
octubre.

## Decisión

El schema `beneficiarios` se normaliza así:

- **`persona`** tiene una fila por persona real dentro de cada banco, con los
  datos identificatorios y de contacto. `beneficiario` y `representacion` son
  roles sobre `persona`, y la tabla `representante` desaparece (D1).
- **`consentimiento`** es una tabla append-only con una fila por otorgamiento:
  titular, otorgante, quién lo recoge, fecha, versión del aviso, finalidad y
  clave del soporte en el almacén de objetos (D25). La clave admite NULL hasta
  que exista el almacén y es obligatoria antes del primer dato real (D43).
- **Unicidad** por número normalizado, sin el tipo, y `tipo_documento` es un
  atributo que se puede actualizar (D2). Mientras haya datos sintéticos, la
  clave es `(banco_id, numero_documento)`; con datos reales,
  `(banco_id, documento_hmac)`.
- **Documento** (D40):
  - Mientras solo haya datos sintéticos, `persona.numero_documento` guarda el
    número en claro y normalizado.
  - Antes del primer dato real, el número se cifra por columna con una llave
    que vive fuera de la base, y la unicidad y la búsqueda pasan a
    `documento_hmac`, calculado con una llave propia de cada banco. El mismo
    documento en dos bancos da códigos distintos.
  - La API normaliza, cifra y calcula el HMAC detrás de un puerto de `core`,
    con el adaptador en `repositories/` (RNF-03). La base nunca recibe las
    llaves.
  - SBA-31 decide el algoritmo, la derivación, la custodia, la rotación y la
    recuperación de las llaves, y los documenta en `docs/operacion/llaves.md`.
- **Integridad por banco.** Todas las FKs del schema son compuestas con
  `banco_id` (D14).
- **Actor.** `core.auditoria` (SBA-21) registra actor, banco y fecha de toda
  escritura. Además, algunas tablas guardan el actor en una columna `*_por`
  `varchar(100)`, porque el negocio lo lee: `institucion.actualizado_por`
  (SBA-26, D29), `membresia.creado_por` y `cerrado_por`,
  `consentimiento.recogido_por` y `alerta_duplicidad.creado_por`.

Se aparta de Arquitectura 8.6, el Anexo B y RNF-M2-06 solo en la fecha: el
destino es el mismo, y ningún dato real entra antes de cumplirlo.

El detalle de tablas, restricciones y políticas está en
[esquema_beneficiarios.md](../SBA-15/esquema_beneficiarios.md).

## Alternativas descartadas

**El Anexo B tal como está.** Duplica los datos personales de quien es
beneficiario y representante a la vez, y la unicidad no ve que son la misma
persona.

**Unicidad por `(banco, tipo, número)`.** Parte a la persona cuando pasa de
tarjeta de identidad a cédula. El riesgo de la alternativa elegida está en la
sección de consecuencias.

**Cifrar desde la primera migración (D23, versión 4.2).** Protege datos
sintéticos que una copia no expone, y a cambio metía en la primera migración
el puerto, las llaves y su rotación antes de que SBA-31 las decidiera.

**Documento en claro sin fecha de salida (D18, versión 3.2).** La protección
queda solo en RLS y privilegios, que no cubren una copia de la base con datos
reales.

**Hash sin llave.** Los números de documento son un espacio pequeño y un hash
simple se revierte probando números. RNF-M2-06 lo descarta: «el hash simple no
satisface el diseño».

**Cifrar en la base con `pgcrypto`.** La llave viajaría en cada consulta y
podría quedar en los logs de sentencias. SBA-31 pide la llave fuera de la base.

**Consentimiento en columnas de `persona` (D15, versión 3.2).** Pierde la
autorización anterior cuando cambia el representante.

## Consecuencias

Hay que actualizar el Anexo B de Arquitectura, la sección 5.2 (que nombra
«representantes»), RF-M2-06 del Alcance M2, SBA-15 y SBA-31. SBA-31 pasa a la
fase antes del primer dato real, y su criterio 1 habla de la tabla
`beneficiario`: con este modelo el documento vive en `persona`.

Mientras el documento va en claro, cualquier copia de la base lo muestra. Por
eso la base solo tiene datos sintéticos y producción no se clona a ramas ni
ambientes de prueba (Arquitectura 7.1). El paso a `documento_hmac` es una
migración sobre `persona` que no toca las demás tablas.

La búsqueda por documento solo es exacta. No hay búsqueda por parte del número
ni orden por documento.

Dos personas distintas con el mismo número en tipos de documento distintos
chocan en la unicidad. Es poco probable por los rangos de numeración. Si pasa,
el service no reutiliza a la persona y el caso lo revisa coordinación; en el
portal, las funciones comparan el tipo y rechazan (D41). Cáritas debe aceptar
este riesgo.

Si se pierden las llaves, se pierden los documentos. La prueba de recuperación
de SBA-31 se ejecuta antes de habilitar datos reales.

Con el HMAC por banco, comparar documentos entre bancos es imposible por
construcción. La garantía cubre solo el documento. Nombres, fecha de
nacimiento y contacto quedan en claro, y quien tenga una copia de la base podría
cruzar personas entre bancos con ellos. Los protegen tres controles: RLS por
banco con `FORCE ROW LEVEL SECURITY` y un rol sin `BYPASSRLS` (ADR-07); ningún
rol, ni siquiera `super_admin`, lee datos nominales de otro banco (Arquitectura
8.1 y 8.2); y producción no se clona a ramas ni ambientes de prueba, que usan
datos sintéticos (Arquitectura 7.1). Cifrar esos campos queda fuera de SBA-31.
Un cruce futuro necesitaría un ADR nuevo.

El esquema toma otras decisiones que no son de normalización y tocan `core`
para todos los módulos: un rol de PostgreSQL por rol de aplicación con
`SET LOCAL ROLE` (D26), que entra con el portal de instituciones y corregido
para no quitarle permisos al resto de la API (D41, D51); funciones de contexto en
`core` (D27), que también se deciden con el portal; y reglas de dominio en
services en vez de funciones `SECURITY DEFINER` (D28). Si arquitectura lo
prefiere, van en un ADR propio.

La DIVIPOLA vive en una tabla global de solo lectura, sin `banco_id` (D34).
Es una excepción nueva a la regla de `banco_id` de ADR-07 y AGENTS.md, que hoy
solo exceptúan `red`, `rol` y `usuario`, y aceptar este ADR acepta esa
excepción. El PR que cree la tabla la registra en AGENTS.md y ADR-07 con sus
permisos, solo SELECT para los roles de aplicación, y la incluye en la
verificación de SBA-61.

Identidad étnica y discapacidad, datos sensibles según la Ley 1581, no entran:
D38 los agregaba y se retiró el 2026-09-28 porque ningún ticket los pide, SBA-16
excluye la salud y contradicen la minimización de Arquitectura 8.6 y RNF-M2-07.
Zona, barrio y nacionalidad tampoco entran: D37 los agregaba y se retiró el
mismo día, porque ningún ticket los pide y la nacionalidad junto con una cédula
de extranjería o un PEP marca a las personas migrantes.

Ningún dato real entra hasta que Cáritas cierre SBA-16 y estén los controles
de la sección 9 del esquema: cifrado y HMAC del documento, soporte obligatorio
del consentimiento, supresión, idempotencia completa y prueba de recuperación.

## Cómo se acepta o se refuta

El ADR entra como propuesto y lo revisan los tres capitanes (`CODEOWNERS`). Una
objeción se hace en el PR, citando la decisión del esquema (D-NN) y la fuente o
el caso que la contradice. Si se acepta, el estado pasa a aceptado. Si se
refuta, pasa a rechazado con el motivo, o lo reemplaza otro ADR que lo marque.
