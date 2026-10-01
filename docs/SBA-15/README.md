# SBA-15 · Esquema de datos de M2

Entregable de [SBA-15](https://linear.app/iuva/issue/SBA-15), «Modelo de institución,
beneficiario, membresía y alerta de duplicidad». Describe el schema
PostgreSQL `beneficiarios`: tablas, restricciones, enums, políticas RLS y las reglas que
el esquema deja al código. Lo escribieron Juan David Gaitán y Julián Hinestroza
(Equipo 1, backend) después de dos rondas de revisión sobre el ERD del equipo. Camilo
Agudelo, responsable de arquitectura, lo reestructuró en la versión 5.0.

**Estado: propuesta.** Nada de esto es migración todavía. El esquema entra al
repositorio para que se pueda revisar y refutar antes de escribir SQL. La
normalización que introduce se registra en
[ADR-15](../adr/ADR-15-persona-normalizada-con-documento-cifrado.md), también
propuesto.

| Archivo                                              | Qué es                                                                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [esquema_beneficiarios.md](esquema_beneficiarios.md) | El esquema v5.0: lo que está vigente y en qué fase entra cada pieza. Es lo que se implementa.                                                                                                |
| [decisiones.md](decisiones.md)                       | El historial de decisiones, de la D1 a la D51, con su motivo. Las que cambiaron conservan su texto y dicen qué las ajusta o las retira.                                                      |
| [contraste.md](contraste.md)                         | Comparación de la versión 3.2 con Arquitectura v1.2, Alcance M2, los ADR, el código de `core`, SBA-26, SBA-31 y SBA-48: 22 hallazgos y el estado de cada uno en la versión 5.0. Es historia. |

## Cómo leerla

Para implementar, basta el esquema. Sus secciones 1 a 3 dan el glosario y las fases; las
4 a 7, las migraciones A y B y las reglas de los services, que es lo primero que se
construye. Cuando una regla parezca rara, busca su número (D-NN) en `decisiones.md`.
`contraste.md` explica de dónde salieron las versiones 4.x y no hace falta para
implementar.

## Qué cambió en la 5.0

La versión 5.0, del 2026-09-29, recoge las decisiones D40 a D51; el responsable de arquitectura confirmó D50 y D51
el 2026-09-30. La primera
migración queda en dos partes pequeñas, A (instituciones) y B (personas, membresías y
alertas), sin roles nuevos ni funciones privilegiadas. El documento de identidad va en claro
mientras solo haya datos sintéticos, y el cifrado del documento y su HMAC por banco
pasan a los controles antes del primer dato real, junto con el soporte obligatorio del
consentimiento, la supresión, la revocación y la idempotencia completa. Los roles de
PostgreSQL por rol de aplicación (D26) entran con el portal de instituciones,
corregidos. La institución ve a una persona solo mientras tenga una membresía activa en
ella, y `tipo_documento` agrega `ppt`.

La versión 3.2, tal como la entregaron los autores, está en el primer commit del PR.
Los commits siguientes construyen la 4.0, la 4.1, la 4.2 y la 5.0, uno por tema; el PR
los conserva aunque se mezcle con squash.

## Cómo refutarlo

El esquema, las decisiones y el contraste se pueden discutir, también por parte de los
autores del esquema.

1. Comenta en el PR sobre la línea concreta. Cita la decisión (D-NN) o el hallazgo
   (C-NN) que discutes.
2. Una refutación dice qué fuente contradice el texto, o qué caso lo rompe: qué rol, qué
   fila, qué secuencia de operaciones.
3. Si una decisión cambia, entra en `decisiones.md` con el número siguiente y su motivo,
   la anterior recibe la marca «Ajustada por» o «Retirada por» sin perder su texto, y
   `esquema_beneficiarios.md` se corrige al estado nuevo y sube de versión. Si un
   hallazgo cae, se marca como refutado en `contraste.md` con la razón; no se borra.
4. Después del merge, cualquier cambio entra por otro PR sobre esta carpeta.

ADR-15 y D2 se apartan de documentos ya aceptados, y lo que entra con el portal toca
`core`. Los resuelve el responsable de arquitectura, Camilo Agudelo, y lo que toque
datos personales necesita además a Cáritas.

## Límites

- El contraste se hizo contra `origin/main` en `8b942fb` y contra el texto de SBA-26,
  SBA-31 y SBA-48. Según una revisión del modelo hecha el 2026-09-29, fuera del
  repositorio, los criterios que cita el esquema de SBA-27, SBA-28, SBA-32, SBA-33 y
  SBA-44 a SBA-47 coinciden con Linear. SBA-16 espera la respuesta de Cáritas y se
  contrasta cuando llegue.
- El texto de los PDF se extrajo con `pdftotext`. Las citas se cotejaron contra ese texto,
  no contra una versión en Markdown de la arquitectura, que todavía no existe en
  `docs/arquitectura/`.
- No hay migración ni pruebas. Las secciones 5.5 y 6.9 del esquema describen las
  pruebas; se escriben con cada migración.
