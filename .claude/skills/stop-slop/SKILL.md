---
name: stop-slop
description: Escribir o revisar cualquier texto que vaya a leer una persona (cuerpo de PR, README, documentación, comentarios de código, mensajes de error, textos de la PWA) sin patrones de redacción de IA. Usar al redactar de cero y al editar; también cuando se mencione slop, relleno o "suena a IA".
---

# Stop Slop (adaptación para SIGBA)

Skill original en inglés, íntegra abajo con sus referencias. Para SIGBA cambian cuatro cosas.

**Se aplica al escribir de cero**, no solo al editar. Alcanza cuerpos de PR, `README.md`,
`docs/CONTRIBUTING.md`, los README de módulo, los comentarios de código, los mensajes de
error de la API y de CI, y los textos que ve el operario en la PWA. Repasa cualquiera de
esos con `references/` antes de entregarlo.

**La salida va en español.** Las listas de `references/phrases.md` están en inglés: aplica
el patrón, no la frase literal. En español los equivalentes más frecuentes son "Aquí está
la cosa:", "La verdad es que", "No es X, es Y", "Esto importa porque", "Vale la pena
notar", los adverbios de relleno ("realmente", "simplemente", "básicamente", "esencialmente"),
las listas de tres por inercia, las rayas largas y el metacomentario ("en esta sección
veremos", "como podemos observar").

**El changelog solo cuando editas** un texto ajeno. Al escribir de cero entrega el texto.

**Dos textos tienen destinatario distinto y mandan sobre el estilo general.** Los mensajes
que lee un compañero de bodega deben decir qué pasó y qué hacer, sin metáforas ni tono
publicitario: "Sin señal · lo registrado se sincroniza al volver" cumple. Los documentos de
`docs/` transcritos del PDF de arquitectura conservan la redacción del documento original;
ahí la fidelidad manda sobre el estilo.

Regla que se solapa con el repo: sin rayas largas en texto de cara al usuario ni en
documentación.

---

# Stop Slop

Edit existing prose to remove predictable AI writing patterns. Return the revised text with a brief summary of what changed.

## What This Skill Does

Takes a user's draft and applies the rules in the reference files to produce cleaner, more direct prose. The output is always:

1. The revised text
2. A short changelog (bullet list, plain language, no more than 8 items)

## Process

### Step 1: Read the reference files

Before editing, read all three:

- `references/phrases.md` — phrases and adverbs to cut or replace
- `references/structures.md` — structural patterns to break
- `references/examples.md` — before/after pairs to calibrate judgment

### Step 2: Edit the draft

Work through the text top to bottom. Apply every rule. Do not skip patterns because they feel minor. Common fixes ranked by frequency:

1. Cut throat-clearing openers ("Here's the thing:", "It turns out", "The truth is")
2. Kill all adverbs (-ly words, "really", "just", "actually", "genuinely", etc.)
3. Rewrite binary contrasts ("Not X. Y." → state Y directly)
4. Replace passive voice (find the actor, put them at the front)
5. Name the human behind false agency ("the data tells us" → "the analysis shows" or name who drew the conclusion)
6. Remove vague declaratives ("The implications are significant" → name the specific implication or cut)
7. Break formulaic structures (negative listings, dramatic fragmentation, rhetorical setups)
8. Replace business jargon (navigate → handle, landscape → situation, lean into → accept)
9. Cut meta-commentary ("Let me walk you through", "As we'll see", "In this section")
10. Fix sentence starters (restructure Wh- openers; cut "So," paragraph starters; remove "Look,")
11. Remove em dashes — replace with commas or periods
12. Trim three-item lists to two where possible

When in doubt about whether to cut something: cut it.

### Step 3: Write the changelog

After the revised text, write a brief changelog. Format:

---

**What changed:**

- [Pattern removed or fixed] — [one-line explanation]
- ...

Keep it under 8 bullets. Group similar changes. No need to cite every instance, just the pattern types that appeared.

## Output Format

```
[Revised text, clean, no annotations inline]

---
**What changed:**
- ...
```

Do not add any preamble before the revised text. Do not explain what you are about to do. Start with the edited prose.
