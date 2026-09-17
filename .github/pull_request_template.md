## Qué cambia

<!-- Una o dos frases. Qué hace distinto el sistema después de este PR. -->

Cierra SBA-

## Cómo lo verifico

<!-- Pasos para que el revisor lo compruebe, o el escenario de la prueba. -->

## Definición de terminado

- [ ] Los checks de CI están en verde: `rama`, `lint`, `typecheck`, `test`, `build`.
- [ ] Hay pruebas de lo que cambié; la lógica de dominio se escribió con TDD (RNF-02).
- [ ] Cobertura de `services/` en 70 % o más (RNF-02).
- [ ] El lint de fronteras pasa sin errores: no importé rutas internas de otro módulo (Arquitectura 5.2).
- [ ] La lógica de dominio no importa SDK de proveedores; van detrás de un puerto de `core` (RNF-03).
- [ ] Todo endpoint nuevo exige JWT válido y rol autorizado (RNF-01).
- [ ] Las tablas operativas que toqué llevan `banco_id` y política RLS, con prueba de aislamiento (RNF-01, ADR-07).
- [ ] Toda escritura de negocio registra actor, banco y fecha en auditoría (RNF-04).
- [ ] No hay datos personales reales ni secretos en el código, las pruebas ni las trazas.
- [ ] El ticket de Linear queda enlazado y en el estado que corresponde.

## Contratos

- [ ] Este PR **no** cambia un servicio público, un DTO compartido ni un evento.
- [ ] Sí lo cambia, y entonces: está en `packages/shared-types` o en el `index.ts` del módulo,
      el contrato quedó versionado, y etiqueté al equipo consumidor además del
      responsable de arquitectura (Arquitectura 5.2).

## Notas para quien revisa

<!-- Lo que te preocupa, lo que dejaste pendiente, lo que decidiste y por qué. -->
