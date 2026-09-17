---
name: ponytail
description: Simplificar la solución al escribir, corregir o revisar código de SIGBA. Usar también cuando se pida Ponytail, YAGNI o reducir complejidad. Admite lite, full y ultra.
license: MIT
---

# Ponytail

Adaptación para SIGBA de la skill Ponytail instalada en el perfil del usuario.
Busca la solución más simple que cumpla el comportamiento solicitado.

## Método

1. Lee el flujo afectado y sus consumidores antes de elegir la solución. En SIGBA un
   consumidor puede estar en otro módulo, detrás de un `index.ts`, o ser un suscriptor
   de evento; el `grep` del nombre no basta.
2. Reutiliza código y patrones existentes; luego considera biblioteca estándar,
   capacidades nativas y dependencias ya instaladas. Las versiones compartidas viven en
   el catálogo de `pnpm-workspace.yaml`: una dependencia nueva se añade ahí, no suelta.
3. Añade código o dependencias solo cuando lo anterior no resuelva el requisito.
4. Corrige la causa compartida del fallo, comprobando los consumidores afectados.
5. Elimina complejidad innecesaria: wrappers sin responsabilidad, configuración
   especulativa, duplicación y abstracciones con un solo caso sin beneficio concreto.
6. Verifica el comportamiento con la infraestructura existente. En SIGBA las pruebas son
   Vitest; las de `services/` van al lado del código, las de frontera en `apps/api/test/`.
   No inventes otro sistema de pruebas.

## Intensidad

- **lite**: cumple lo pedido y señala una alternativa más simple si resulta relevante.
- **full** (por defecto): aplica el método y entrega el menor cambio claro que resuelva la tarea.
- **ultra**: busca eliminar conceptos o capas completas dentro del alcance autorizado.

La intensidad rige la tarea actual salvo que el usuario solicite mantenerla.
No sacrifiques legibilidad por contar líneas ni introduzcas abstracciones solo para
reducir el tamaño de un archivo.

## Lo que en SIGBA nunca es complejidad sobrante

El documento de arquitectura paga estas cosas a propósito. Simplificarlas es romperlas.

- El aislamiento por banco: `banco_id`, RLS, contexto de transacción (ADR-07). Es el
  atributo de calidad número uno y trata datos de menores.
- La idempotencia por `(banco_id, comando_id)` y el libro de movimientos append-only
  (ADR-08). Un stock editable «más simple» pierde la evidencia.
- La escritura del outbox dentro de la transacción del dominio (ADR-09).
- El paso por `index.ts` entre módulos. El import directo es más corto y rompe el trabajo
  en paralelo de tres equipos (Arquitectura 5.2).
- Los puertos de proveedor: `services/` no importa SDK (RNF-03). El SDK directo ahorra
  una interfaz y ata el dominio al proveedor.
- La verificación humana antes de escribir inventario desde una foto (ADR-12).

Si una de estas te parece sobrante, dilo como hallazgo y explica el porqué; no la quites.

## Límites y entrega

Conserva validaciones, seguridad, accesibilidad, integridad de datos y requisitos explícitos.
No reduzcas unilateralmente el alcance pedido. Revisa sin editar si el usuario pidió revisión.

Los nombres del dominio van en español y los técnicos en inglés (RS-09). Renombrar por gusto
no es simplificar.

Explica el resultado, las comprobaciones y cualquier límite real de la simplificación.
Si se pidió un análisis detallado, entrégalo. No impongas límites artificiales de respuesta.
