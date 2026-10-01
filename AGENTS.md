# SIGBA: guía para agentes

SIGBA es el sistema de inventario y beneficiarios para bancos de alimentos; el Banco de
Alimentos de Pereira es el piloto y cada banco es un tenant aislado. Guarda datos de
población vulnerable, incluidos menores: cuando dos atributos compiten, gana el
aislamiento entre bancos (Arquitectura 1.2).

Fuera de alcance (RS-06): contabilidad, facturación electrónica, nómina, certificados de
donación, solicitudes de institución, rutas y vehículos, voluntariado y aplicación
nativa. Mekano sigue como sistema contable; SIGBA le entrega exportables (RS-08). Si el
ticket pide algo de esa lista, para y pregunta.

Linear es la fuente de verdad: <https://linear.app/iuva/team/SBA>. La rama se llama
`sba-<n>-<titulo>`, copiada del ticket; el check `rama` de CI bloquea el merge si no
cuadra. El tipo (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`) va en el
commit y en el título del PR, no en la rama. El último párrafo del commit dice
`Cierra SBA-NN`. Detalle en [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Arranque

Node 24 (`.nvmrc`) y pnpm 11.18.0. `pnpm` siempre, nunca `npm`.

```bash
corepack prepare pnpm@11.18.0 --activate
pnpm install
cp .env.example .env
docker compose up -d
pnpm dev
```

## Dónde va cada cosa

`apps/api/src` es NestJS en un solo proceso (ADR-01):

- `core/`: auth, contexto de tenant, roles, outbox, auditoría y puertos de proveedores.
  Tiene CODEOWNER: todo cambio pasa por revisión de arquitectura.
- `modules/<modulo>/` para `plataforma`, `inventario`, `beneficiarios` y `analitica`.
  Dentro: `index.ts` (API pública), `controllers/` (traducen HTTP, sin reglas de
  negocio), `services/` (dominio, con TDD), `repositories/` (aquí sí entra Prisma),
  `dto/` (se valida en ejecución con class-validator, ADR-04) y `events/`.
- Módulo nuevo: `pnpm nuevo-modulo <nombre>` crea la estructura vacía. La referencia con
  controlador, servicio probado y DTO es `modules/health`; cópiala a mano.

`apps/web/src` es la PWA React + Vite (ADR-02): `app/` (router y providers),
`features/<modulo>/` (pantallas por módulo), `offline/` (cola de comandos y caché,
ADR-10), `shared/` (cliente HTTP y hooks) y `ui/` (componentes propios; lo que usen dos
features sube a `packages/ui`).

`packages/shared-types` es contrato entre API y PWA. Un cambio ahí, en un `index.ts` de
módulo o en un evento exige revisión de arquitectura y del equipo consumidor, y
actualiza a los consumidores en el mismo PR (Arquitectura 5.2).

## Fronteras que el lint verifica

Cuatro reglas en `packages/config/eslint.fronteras.js` (Arquitectura 5.2):

1. Un módulo importa de otro solo por su `index.ts`. Si lo que necesitas no está
   exportado ahí, no es API pública: pídeselo al equipo dueño, no lo exportes tú.
2. `core` no importa módulos funcionales (ADR-01).
3. Nadie importa `analitica`: solo expone HTTP y consume eventos (ADR-09).
4. `services/` y `events/` no importan SDK de proveedores; el puerto va en `core` y el
   adaptador en `repositories/` (RNF-03, ADR-11).

Un `eslint-disable` sobre estas reglas nunca es la solución.

Lo que el lint **no** restringe: qué módulo funcional importa a cuál. Fuera de
`analitica`, que no importa nadie, cualquiera de los otros tres puede importar el
`index.ts` de otro. `core` queda aparte: la regla 2 le prohíbe importar módulos. Que
hoy `inventario` consulte `InstitucionesService` (ADR-14) y nadie más cruce es diseño,
no una regla verificada.
Antes de crear una dependencia nueva entre módulos, háblalo con el equipo dueño: el lint
te va a dejar.

## Invariantes que el lint no ve

- Toda tabla operativa lleva `banco_id` y política RLS con USING y WITH CHECK, más una
  prueba de aislamiento que demuestre cero filas de otro banco (ADR-07). Excepción: las
  entidades globales `red`, `rol` y `usuario`, con permisos propios. El contexto de banco
  se fija con `set_config(..., true)` dentro de la transacción y toda consulta usa ese
  cliente (Arquitectura 8.1).
- Movimiento, saldo derivado, auditoría y outbox confirman o revierten juntos, en una
  sola transacción y con el mismo cliente Prisma transaccional (ADR-08, ADR-09). Un
  `await` a algo fuera de la transacción rompe la garantía.
- El stock no se edita: es un saldo derivado del libro, con bloqueo por banco, bodega y
  lote y CHECK no negativo. `movimiento` y `auditoria` son append-only (ADR-08).
- Toda escritura de negocio registra `(banco_id, comando_id)` y el hash de la carga.
  Misma carga: devuelve el resultado previo. Otra carga con la misma clave: 409
  (Arquitectura 6.1). El celular reenvía comandos; sin esta clave se duplica inventario.
- Sin precio vigente aprobado, la recepción confirma cantidades y queda con valoración
  pendiente. Nunca cero, nunca un precio vencido, nunca bloquear la recepción (ADR-13).
- Datos personales de beneficiarios: documento cifrado y con HMAC por banco antes del
  primer dato real (SBA-31; mientras solo haya datos sintéticos puede ir en claro); nada en
  logs, trazas de Sentry, cargas de evento, mensajes de error ni IndexedDB sin cifrar
  (Arquitectura 8.6). El token de Auth0 vive en memoria, nunca en localStorage,
  sessionStorage ni IndexedDB (ADR-06).
- Todo endpoint exige JWT válido y rol autorizado (RNF-01). Excepción: `modules/health`,
  la sonda de Fly.io.
- Toda escritura de negocio registra actor, banco y fecha en auditoría (RNF-04).
- `beneficiarios` consume `SalidaRegistrada` y no escribe inventario (ADR-14). Lo que
  calcula es cobertura estimada, nunca entrega individual acreditada.
- En la PWA, un registro local dice «pendiente de sincronizar» hasta que la API
  responda, y el stock en caché se avisa como posiblemente desactualizado (ADR-10).
- Nombres del dominio en español (`recepcion`, `lote`, `bodega`); nombres técnicos en
  inglés (RS-09).

## Verificar

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Son cuatro de los cinco checks que bloquean el merge (el check `lint` incluye prettier);
el quinto, `rama`, solo depende del nombre. `pnpm test` mide la cobertura de `services/` y falla bajo el 70 % (RNF-02),
y corre la e2e que levanta `AppModule`: es la única que detecta un proveedor mal
declarado en Nest. Solo datos sintéticos fuera de producción; los secretos viven en los
servicios, no en Git (Arquitectura 7.1, 7.2).

Antes de abrir el PR aplica las skills de `.claude/skills/`: `ponytail` al escribir
código, `thermo-nuclear-code-quality-review` si tocas `core/`, `prisma/`, RLS o
transacciones, y `stop-slop` en todo texto que lea una persona.
