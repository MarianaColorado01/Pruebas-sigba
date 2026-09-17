# Cómo trabajamos en SIGBA

Linear es la fuente de verdad: <https://linear.app/iuva/team/SBA>

## Arrancar

```bash
corepack prepare pnpm@11.18.0 --activate   # en Windows, "corepack enable" pide terminal de administrador
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

Node 24 (ver `.nvmrc`). Si usas nvm: `nvm use`.

## El ciclo

1. **Toma el ticket en Linear.** Pásalo a _En curso_ y asígnatelo. Si no está en
   la iteración actual, habla con tu capitán antes de empezar.
2. **Crea la rama desde Linear**, con el botón que copia el nombre. Sale así:

   ```
   sba-24-recepcion-manual-con-red
   ```

   Ese formato es obligatorio: el check `rama` de CI lo verifica y bloquea el
   merge si no cuadra. Puedes empujar una rama con otro nombre, pero no
   mezclarla; el error te dice cómo renombrarla. El tipo de cambio (`feat`,
   `fix`, `chore`) va en el mensaje del commit y en el título del PR, no en la
   rama.

3. **Trabaja con TDD en `services/`.** Prueba que falla, código que la pasa,
   limpieza. Mínimo 70 % de cobertura en `services` (RNF-02).
4. **Abre el PR** contra `main`. La plantilla trae la definición de terminado.
5. **Una aprobación** y los cuatro checks en verde. Si tocas `core/`,
   `packages/` o `prisma/`, además revisa el responsable de arquitectura.
6. **Squash al mezclar.** `main` mantiene historial lineal.

## Mensajes de commit

```
<tipo>: <qué hace el cambio, en imperativo y en minúscula>
```

Tipos: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

El cuerpo explica **por qué**, no qué: el diff ya dice qué. Cierra el ticket con
`Cierra SBA-NN` en el último párrafo.

## Antes de pedir revisión

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Son los mismos que corre CI, más el check `rama`, que solo depende del nombre.

## Definición de terminado

Está en la plantilla de PR (`.github/pull_request_template.md`). En resumen:

- Los cinco checks en verde.
- Pruebas de lo que cambiaste; dominio con TDD y 70 % en `services`.
- El lint de fronteras sin errores.
- Endpoints con JWT y rol (RNF-01); tablas con `banco_id`, RLS y prueba de
  aislamiento (ADR-07).
- Toda escritura de negocio registra actor, banco y fecha (RNF-04).
- Sin datos personales reales ni secretos en código, pruebas o trazas.

## Las fronteras entre módulos

Tres reglas, y el lint las comprueba:

**Un módulo entra a otro solo por su `index.ts`.**

```ts
import { StockService } from '../inventario/index.js'; // sí
import { StockService } from '../inventario/services/…'; // no
```

Si lo que necesitas no está exportado en el `index.ts` del otro módulo, no es
API pública. Pídeselo a su equipo.

**`core` no importa módulos funcionales.** La dependencia va en un solo sentido.

**`services/` y `events/` no importan SDK de proveedores.** Ni Prisma, ni Auth0,
ni el cliente S3. Eso va detrás de un puerto de `core`, y el adaptador vive en
`repositories/` (RNF-03).

La referencia viva es `apps/api/src/modules/health`. La prueba que ejerce las
reglas está en `apps/api/test/fronteras.spec.ts`.

## Módulo nuevo

```bash
pnpm nuevo-modulo <nombre>
```

Crea la estructura de Arquitectura 5.3. Después: regístralo en `app.module.ts`,
escribe su responsabilidad, y añade la ruta a `.github/CODEOWNERS`.

## Cambios de contrato

Un cambio en `packages/shared-types`, en el `index.ts` de un módulo o en un
evento es un cambio de contrato. Exige revisión del responsable de arquitectura
**y** del equipo consumidor (Arquitectura 5.2). Etiqueta a ambos en el PR.

Contrato y consumidores cambian en el mismo PR: para eso tenemos un monorepo.

## Datos

Solo datos sintéticos, en todos los ambientes menos producción. No se clona
producción a una rama ni se suben adjuntos reales (Arquitectura 7.1).

Los secretos viven en los servicios, nunca en Git.

## Equipos

| Equipo   | Módulo                          | Capitán                               |
| -------- | ------------------------------- | ------------------------------------- |
| Equipo 1 | `beneficiarios` (M2)            | Camilo Agudelo · @MiloAgudelo         |
| Equipo 2 | `inventario` (M1)               | Juan Ospina · @poethy                 |
| Equipo 3 | `plataforma` y `analitica` (M3) | Mariana Colorado · @MarianaColorado01 |

Arquitectura e integración: Camilo Agudelo.

## Iteraciones

Dos semanas, del jueves al miércoles. El jueves siguiente se planea y el viernes
hay demo interna y retrospectiva. El conteo de historias cierra el miércoles.

| Iteración               | Fechas                           |
| ----------------------- | -------------------------------- |
| 1 · Vertical mínimo     | 17 al 30 de septiembre           |
| 2 · Movimientos y stock | 1 al 14 de octubre               |
| 3 · Precios y reportes  | 15 al 28 de octubre              |
| 4 · Release candidate   | 29 de octubre al 11 de noviembre |
| 5 · Estabilización      | 12 al 25 de noviembre            |

Entrega final: 26 de noviembre de 2026.
