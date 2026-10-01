---
name: thermo-nuclear-code-quality-review
description: Auditoría estricta de mantenibilidad, límites de capas, abstracciones y crecimiento de condicionales. Usar para Termonuclear Code Review o en la revisión previa a abrir o mergear una PR de SIGBA.
---

# Thermo-Nuclear Code Quality Review

Adaptación para SIGBA de la skill instalada en el perfil del usuario.
Busca simplificaciones estructurales que reduzcan conceptos y preserven comportamiento.

## Alcance y evidencia

- Revisa el diff completo de la tarea o PR y el contexto de los consumidores afectados.
  Comprueba la base de comparación; no mezcles cambios locales ajenos.
- Una solicitud de revisión produce hallazgos. Edita solo si el usuario también pidió
  correcciones. La revisión no autoriza publicar comentarios, abrir PRs ni hacer merge.
- No necesitas una cuota de hallazgos: informa cuando no encuentres problemas sustantivos.
- Distingue hechos verificados, riesgos razonados y propuestas que necesitan más evidencia.

## Qué buscar

1. Capas, modos o estados que puedan desaparecer al modelar mejor el problema.
2. Condicionales dispersos, flags y casos especiales que entrelazan responsabilidades.
3. Wrappers de paso, abstracciones genéricas sin beneficio y utilidades duplicadas.
4. Lógica fuera de su capa: negocio en `controllers/`, SQL o Prisma fuera de
   `repositories/`, autorización omitida, detalles internos filtrados al consumidor.
5. Casts, opcionalidad y fallbacks que ocultan un contrato o una invariante.
6. Funciones y archivos sin cohesión. Cruzar 1.000 líneas es una señal para investigar,
   no un fallo automático ni razón suficiente para fragmentar el archivo.
7. Actualizaciones relacionadas no atómicas y orquestación secuencial innecesaria.
   Propón paralelismo solo si las operaciones son independientes y mejora el flujo.
8. Refactors que reparten la misma complejidad entre más archivos sin reducirla.

Prioriza quitar conceptos y reutilizar las capas existentes. Extrae funciones o módulos
cuando aporten una responsabilidad clara; una máquina de estados o un objeto de políticas
no es una mejora por sí mismo. Aplica el criterio de simplicidad de Ponytail.

## Lo que en SIGBA se revisa además

- **Fronteras.** Un import que entra a las carpetas de otro módulo, o `core` importando un
  módulo funcional. El lint lo atrapa; un `eslint-disable` para saltárselo es un hallazgo
  bloqueante, no un atajo (Arquitectura 5.2).
- **Contratos.** Un cambio en `packages/shared-types`, en el `index.ts` de un módulo o en la
  forma de un evento afecta a otro equipo. Si el PR no trae al consumidor actualizado ni al
  equipo etiquetado, es un hallazgo.
- **Aislamiento.** Tabla operativa sin `banco_id`, sin política RLS o sin prueba de
  aislamiento. Consulta que confía solo en el filtro de la API (ADR-07).
- **Atomicidad.** Movimiento, saldo derivado, auditoría y outbox tienen que confirmar o
  revertir juntos. Un `await` fuera de la transacción es un hallazgo (ADR-08, ADR-09).
- **Idempotencia.** Escritura de negocio sin clave `(banco_id, comando_id)`, o que trata un
  reintento como un registro nuevo (Arquitectura 6.1).
- **Valoración.** Precio ausente resuelto con cero, con un precio vencido o bloqueando la
  recepción. La recepción confirma cantidades y marca valoración pendiente (ADR-13).
- **Datos personales.** Documento sin cifrar o sin HMAC por banco cuando ya hay datos reales
  (SBA-31; con datos sintéticos puede ir en claro), o carga con datos personales en logs,
  trazas o eventos (Arquitectura 8.6, RNF-04).

## Resultado

Ordena hallazgos por impacto. Para cada uno indica ubicación, escenario concreto,
consecuencia y la corrección mínima o alternativa estructural que lo resolvería.
Separa bloqueantes demostrados de sugerencias; evita objeciones puramente cosméticas.
Resume qué comprobaste y qué no pudiste comprobar. No afirmes que las pruebas pasan sin ejecutarlas.

Si se autorizó corregir, preserva comportamiento y añade o ejecuta pruebas proporcionales.
Una revisión de mantenibilidad no sustituye pruebas funcionales, de RLS ni de seguridad.
