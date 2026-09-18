# Componentes de interfaz

Aquí viven los componentes de shadcn y los propios de esta aplicación
(Arquitectura 5.3). Cuando uno lo necesiten dos features o más, sube a
`packages/ui`.

## Añadir un componente

```bash
pnpm --filter @sigba/web dlx shadcn@latest add dialog
```

Cae en esta carpeta porque `components.json` apunta los alias a `@/ui` y
`@/shared`, no a las carpetas por defecto de shadcn: la §5.3 fija las carpetas
de la PWA y no incluye `components/` ni `lib/`.

Los componentes del estilo `base-mira` traen `cn` del paquete `cn`, así que no
hace falta un `utils.ts` propio. Si algún día un componente lo pide, créalo en
`src/shared/utils.ts`, que es adonde apunta el alias.

El estilo es `base-mira` sobre Base UI, el mismo que el equipo usa en otros
proyectos.

## Iconos

HugeIcons, importando cada icono por su nombre para que el bundle no arrastre
los 6.704 del catálogo.

```tsx
import { BubbleChatIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

<HugeiconsIcon icon={BubbleChatIcon} size={18} aria-hidden />;
```

Un icono que acompaña texto lleva `aria-hidden`. Un icono que es el único
contenido de un botón necesita nombre accesible en el botón.

## Tipografía

Inter, autoalojada con `@fontsource-variable/inter` e importada desde
`index.css`. No se sirve desde un CDN a propósito: en bodega la señal es
inestable y una fuente que depende de la red no carga cuando más falta hace
(ADR-10).

El service worker precacha los subconjuntos `latin` y `latin-ext`, que cubren el
español. Cirílico, griego y vietnamita quedan fuera del precache en
`vite.config.ts`: siguen en el build por si algún glifo los necesita, pero no
ocupan 85 KB en el celular del operario.

## Tamaños de toque

El operario usa el celular con guantes, a contraluz y con prisa
(Arquitectura 1.3), así que la escala de tamaños de `button.tsx` **no es la de
`base-mira`**. El preset viene de escritorio denso: su tamaño por defecto son
28 px y el mayor 32, y ninguno se acierta con guantes. Aquí el tamaño por
defecto son 44 px y el mayor 48; `xs` y `sm` quedan para tablas de
administración en pantalla grande.

Esto tiene un costo que conviene saber: **un componente que llegue con
`shadcn add` trae la escala del preset**, y hay que ajustarlo al añadirlo.
`button.spec.ts` vigila el caso de que alguien regenere el botón, porque ese
sobrescrito se lleva por delante el comentario que lo explica.

Los números son un piso, no una medición. SBA-62 los comprueba en los celulares
del Banco, junto con el contraste del tema en claro y oscuro.
