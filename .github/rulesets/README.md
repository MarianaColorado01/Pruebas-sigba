# Rulesets de `main`

GitHub **no lee estos ficheros por sí solo**. Son la fuente de verdad versionada;
para que surtan efecto hay que aplicarlos:

```bash
# Crear por primera vez
gh api --method POST repos/MiloAgudelo/sigba/rulesets \
  --input .github/rulesets/proteccion-de-main.json

# Actualizar (el id sale de: gh api repos/MiloAgudelo/sigba/rulesets)
gh api --method PUT repos/MiloAgudelo/sigba/rulesets/23604539 \
  --input .github/rulesets/proteccion-de-main.json
```

Por API los _status checks_ requeridos se declaran por nombre aunque el workflow
no haya corrido nunca; por la interfaz de Settings solo aparecen los que ya
corrieron al menos una vez. Por eso los cinco checks quedaron exigidos desde el
primer minuto.

Los nombres van sin tildes a propósito: `gh` en Windows los envía mal
codificados y el ruleset queda con el nombre roto.

## `proteccion-de-main.json`

Rama por defecto. Prohíbe borrarla y el force-push, exige historial lineal, un
PR con una aprobación y revisión de Code Owners, resolución de los hilos de
revisión, y los cinco checks de `ci.yml` en verde con la rama al día. Solo
permite _squash_.

El rol **Repository admin** tiene bypass en modo `always`. Eso cubre el arranque
de la Iteración 0 y las emergencias. Consecuencia: **nadie más puede tener
permiso Admin sobre el repositorio**, porque el bypass se concede por rol, no por
persona. Los catorce colaboradores van con permiso _Write_.

GitHub añade solo `require_extra_approval_for_unattributed_changes`. Es su valor
por defecto: exige una aprobación extra cuando el PR trae commits que no se
atribuyen a un colaborador del repositorio.

## El formato de rama no se puede exigir aquí

Había un segundo ruleset con `branch_name_pattern`. **No existe en este plan.**
Las reglas de patrón —`branch_name_pattern`, `commit_message_pattern`,
`commit_author_email_pattern`, `tag_name_pattern`— solo están disponibles en
repositorios propiedad de una organización. En un repositorio de cuenta
personal, aunque el titular tenga GitHub Pro, la API responde:

```
422  Invalid rule 'branch_name_pattern'
```

Mover el repositorio a una organización gratuita empeoraría las cosas: los
repositorios privados de una organización Free no tienen rulesets en absoluto, y
se perdería la protección que hoy da el Pro personal. Haría falta GitHub Team,
que se cobra por persona.

**Lo que hacemos en su lugar:** el job `rama` de `ci.yml` comprueba el nombre
contra `^sba-[0-9]+-[a-z0-9-]+$` y es un check requerido. No impide crear la
rama, pero impide mezclarla, que es lo que importa, y el mensaje de error
explica cómo renombrarla.

`enforcement: "evaluate"` —el modo que reporta sin bloquear— tampoco está en
este plan: requiere Enterprise.
