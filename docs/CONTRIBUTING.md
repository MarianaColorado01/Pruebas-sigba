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
   limpieza. El check `test` mide la cobertura de `services/` y falla por debajo
   del 70 % (RNF-02); no es un recordatorio, es una puerta.
4. **Abre el PR** contra `main`. La plantilla trae la definición de terminado.
5. **Una aprobación** y los cinco checks en verde. Si tocas `core/`,
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

`pnpm test` incluye la cobertura de `services/` y la prueba e2e que levanta
`AppModule`. Esa e2e es la única que detecta un proveedor mal declarado: una
prueba unitaria construye la clase a mano y nunca toca el contenedor de Nest.

## Definición de terminado

Está en la plantilla de PR (`.github/pull_request_template.md`). En resumen:

- Los cinco checks en verde.
- Pruebas de lo que cambiaste; dominio con TDD y 70 % en `services`, que mide el
  check `test`.
- El lint de fronteras sin errores.
- Endpoints con JWT y rol (RNF-01); tablas con `banco_id`, RLS y prueba de
  aislamiento (ADR-07).
- Toda escritura de negocio registra actor, banco y fecha (RNF-04).
- Sin datos personales reales ni secretos en código, pruebas o trazas.

## Las fronteras entre módulos

Cuatro reglas, y el lint las comprueba:

**Un módulo entra a otro solo por su `index.ts`.**

```ts
import { StockService } from '../inventario/index.js'; // sí
import { StockService } from '../inventario/services/…'; // no
```

Si lo que necesitas no está exportado en el `index.ts` del otro módulo, no es
API pública. Pídeselo a su equipo.

**`core` no importa módulos funcionales.** La dependencia va en un solo sentido.

**Nadie importa `analitica`,** ni siquiera por su `index.ts`. Solo expone
endpoints HTTP y se alimenta de eventos.

**`services/` y `events/` no importan SDK de proveedores.** Ni Prisma, ni Auth0,
ni el cliente S3. Eso va detrás de un puerto de `core`, y el adaptador vive en
`repositories/` (RNF-03).

La referencia viva es `apps/api/src/modules/health`. La prueba que ejerce las
reglas está en `apps/api/test/fronteras.spec.ts`.

## Interfaz

La PWA usa shadcn sobre Base UI, con Inter autoalojada y HugeIcons. Los
componentes viven en `apps/web/src/ui`:

```bash
pnpm --filter @sigba/web dlx shadcn@latest add dialog
```

Antes de escribir un componente a mano, mira si shadcn ya lo trae. Los detalles
y las razones están en `apps/web/src/ui/README.md`.

## Módulo nuevo

```bash
pnpm nuevo-modulo <nombre>
```

Crea la estructura de Arquitectura 5.3. Después: regístralo en `app.module.ts`,
escribe su responsabilidad, y añade la ruta a `.github/CODEOWNERS`.

## Revisión automática

CodeRabbit revisa cada PR contra `main` y comenta en español. **No bloquea el
merge**: la puerta siguen siendo los cinco checks y la aprobación humana. Si se
equivoca, respóndele en el hilo y sigue.

No repite lo que ya cubre CI. El formato lo pone prettier, las fronteras y el
veto a los SDK los comprueba el lint, y la cobertura la mide `test`. CodeRabbit
mira lo que ninguna herramienta puede ver: que una tabla nueva traiga `banco_id`
y su política RLS, que movimiento, saldo, auditoría y outbox confirmen en la
misma transacción, que la escritura lleve clave de idempotencia, y que no se
escape un dato personal a un log o a un evento.

Las reglas están en `.coderabbit.yaml`, en la raíz. Si una te parece equivocada,
cámbiala por PR: son instrucciones, no dogma. **Ojo**: CodeRabbit lee ese fichero
desde la rama base, así que un cambio no surte efecto hasta que entra en `main`.

### Cuando el dueño de la ruta eres tú

Las rutas de contrato (`core/`, `packages/`, `prisma/`, los `index.ts` de módulo)
tienen un solo dueño: el responsable de arquitectura. GitHub acepta a cualquiera
de los dueños que se listen, así que añadir más capitanes ahí los volvería
intercambiables y un cambio de contrato podría entrar sin arquitectura ni equipo
consumidor, justo al revés de lo que pide la sección 5.2.

El precio de eso: cuando el propio responsable escribe en esas rutas, GitHub no
le deja aprobarse. Pide revisión a un capitán de todos modos y mezcla con el
bypass. La revisión ocurre aunque GitHub no pueda exigirla; saltársela porque se
puede es el único punto donde el bypass quita una red propia.

La infraestructura del repositorio (`.github/`, `.coderabbit.yaml`, `scripts/`,
los manifiestos de la raíz) la firma cualquiera de los tres capitanes: ahí no hay
contrato que proteger y un dueño único deja el repositorio parado si esa persona
falta una semana de corte.

### Sobre la licencia

El plan gratuito de CodeRabbit no cubre repositorios privados como este, así que
hay **un asiento pagado**. Quien no tiene asiento sigue recibiendo algo mientras
`enable_free_tier` esté activo, pero la documentación de CodeRabbit se
contradice sobre qué: su página de asientos habla de revisiones y el propio bot
dice que son solo resúmenes de PR. **Está por comprobar**, y se comprueba solo:
cuando alguien sin asiento abra un PR, se ve qué llega.

Eso depende de que la asignación de asientos esté en **Manual approval** en el
panel de CodeRabbit. En **Auto-approval**, abrir un PR sin asiento provisiona
una licencia y genera un cobro prorrateado: con catorce personas, la factura se
dispara sola.

## Cambios de contrato

Un cambio en `packages/shared-types`, en el `index.ts` de un módulo o en un
evento es un cambio de contrato. Exige revisión del responsable de arquitectura
**y** del equipo consumidor (Arquitectura 5.2). Etiqueta a ambos en el PR.

Contrato y consumidores cambian en el mismo PR: para eso tenemos un monorepo.

## Documentos de un ticket

Los entregables que no son código (informes, mapeos, hojas de cálculo) van en
`docs/SBA-NN/`, con un `README.md` que diga qué es cada archivo, el resultado y
sus límites. Entran por PR como cualquier cambio, con el formato de rama y de
commit de arriba (tipo `docs`), y los aprueba arquitectura.

Si el documento cambia una decisión, enlázalo desde el ADR que corresponda en
vez de copiar su contenido.

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
