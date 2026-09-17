# health · plantilla de módulo

Este es el módulo que copia `pnpm nuevo-modulo <nombre>`. También es la sonda
que Fly.io consulta para saber si la máquina responde (SBA-7).

## La forma

```
<modulo>/
├── index.ts              API pública. Lo único que otro módulo puede importar.
├── <modulo>.module.ts    El módulo de Nest.
├── controllers/          Traducen HTTP. Sin reglas de negocio.
├── services/             Lógica de dominio. TDD, 70 % de cobertura (RNF-02).
├── repositories/         Acceso a datos. Aquí sí entra Prisma.
├── dto/                  Lo que cruza la frontera HTTP. Se valida en ejecución.
└── events/               Eventos que el módulo publica y consume.
```

Estructura de Arquitectura 5.3.

## Las tres reglas que el lint comprueba

**Uno.** Un módulo importa de otro solo por su `index.ts`. Esto pasa:

```ts
import { StockService } from '../inventario/index.js';
```

Esto falla:

```ts
import { StockService } from '../inventario/services/stock.service.js';
```

Si lo que necesitas no está exportado en el `index.ts` del otro módulo, no es
API pública. Pídeselo a su equipo; no lo tomes por la puerta de atrás.

**Dos.** `core` no importa módulos funcionales. La dependencia va en un solo
sentido (ADR-01).

**Tres.** `services/` y `events/` no importan SDK de proveedores: ni Prisma, ni
Auth0, ni el cliente S3. Eso vive detrás de un puerto de `core`, y el adaptador
va en `repositories/` (RNF-03).

La prueba que verifica que el lint falla está en
`apps/api/test/fronteras.spec.ts`. Si alguien relaja la regla, esa prueba se
pone roja.

## Por qué el servicio recibe un reloj

`SaludService` toma `() => Date` en el constructor. Así la prueba fija el
momento sin parchear `Date` global. Mismo patrón para cualquier dependencia que
haga la prueba lenta o no determinista: entra por el constructor.
