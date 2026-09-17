# Rulesets de `main`

GitHub **no lee estos ficheros por sí solo**. Son la fuente de verdad versionada;
para que surtan efecto hay que aplicarlos:

```bash
# Crear por primera vez
gh api --method POST repos/MiloAgudelo/sigba/rulesets \
  --input .github/rulesets/proteccion-de-main.json

# Actualizar uno existente (RULESET_ID sale de: gh api repos/MiloAgudelo/sigba/rulesets)
gh api --method PUT repos/MiloAgudelo/sigba/rulesets/RULESET_ID \
  --input .github/rulesets/proteccion-de-main.json
```

Por API los *status checks* requeridos se declaran por nombre aunque el workflow
no haya corrido nunca; por la interfaz de Settings solo aparecen los que ya
corrieron al menos una vez.

## Qué hace cada uno

**`proteccion-de-main.json`** · Rama por defecto. Prohíbe borrarla y el
force-push, exige historial lineal, un PR con una aprobación y revisión de Code
Owners, resolución de los hilos de revisión, y los cuatro checks de `ci.yml` en
verde con la rama al día. Solo permite *squash*.

El rol **Repository admin** tiene bypass en modo `always`. Eso cubre el arranque
de la Iteración 0 y las emergencias. Consecuencia: **nadie más puede tener
permiso Admin sobre el repositorio**, porque el bypass se concede por rol, no por
persona. Los catorce colaboradores van con permiso *Write*.

**`formato-de-rama.json`** · Todas las ramas **menos `main`**. Exige el nombre que
genera Linear (`sba-<número>-<título>`). Excluir `main` no es opcional: `main` no
cumple el patrón, y sin la exclusión el ruleset la deja sin poder recibir push.
Sin bypass: aplica también al titular.

## Cuándo usar tu bypass

Para el arranque y para emergencias. Cuando toques `core/`, `packages/` o
`prisma/` después de la Iteración 0, abre PR igual aunque puedas saltártelo: eres
el CODEOWNER de esas rutas, así que el bypass desactiva justo la revisión que el
documento de arquitectura pide para tu propio trabajo.
