# core

Infraestructura compartida: autenticación, contexto de tenant, roles, manejo de
errores, logging, outbox, auditoría y los puertos de proveedores
(Arquitectura 5.2).

**`core` no es un módulo de alcance.** Vive al lado de `modules/`, no dentro. La
dependencia va en un solo sentido: los módulos importan `core`; `core` nunca
importa un módulo. El lint lo comprueba y falla si se invierte (ADR-01).

## Estado

- Contexto de tenant (`AsyncLocalStorage`) y RLS por banco: implementado en SBA-6.
  `executeTransactionWithTenant` acepta `{ timeout, maxWait }` como cuarto
  parámetro opcional (SBA-64), ver abajo.
- Guard JWT, puerto `TokenVerifier` y adaptador Auth0: implementado.
- Roles por banco, `@Roles()` y contexto de petición: implementado en SBA-18.
- `@Autenticado()` para rutas sin asignación: SBA-19.
- `AuditService` y auditoría base: SBA-21.
- `IdempotenciaService` y `core.comando_procesado`: SBA-69. Ver
  [docs/arquitectura/idempotencia-de-comandos.md](../../../../docs/arquitectura/idempotencia-de-comandos.md).
- `OutboxService.emitir()` escribe eventos dentro de la transacción del caso de uso: SBA-30.
  Los contratos permanecen en borrador hasta la aprobación de arquitectura y de los equipos
  consumidores.
- `DespachadorDeEventos` entrega el outbox a los consumidores en proceso: SBA-49. Ver abajo.
- Puerto `EnviadorDeCorreo` con adaptador SMTP y nulo: SBA-19 (D1).
- Logs y errores (SBA-83, RNF-M3-08): `registrarPeticiones` escribe una línea por
  petición con `peticionId`, ruta como patrón, estado, módulo, usuario interno y
  banco, sin cuerpo, cabeceras ni consulta. `FiltroDeErrores` manda cada 5xx al
  puerto `ReportadorDeErrores`; el adaptador de Sentry usa su API HTTP, sin SDK.
  Un error inesperado viaja sin mensaje, solo con su código y la pila, porque el
  de Prisma puede repetir los datos de la consulta; el de una `HttpException`
  viaja depurado (`depurar`). La respuesta de un 5xx inesperado solo lleva el
  `peticionId`, el mismo de la cabecera `X-Request-Id`.
- Puertos de almacenamiento, visión y precios: SBA-13 y SBA-54.

## Quién entra a cada ruta

Toda ruta lleva exactamente uno de estos tres decoradores;
`test/cobertura-rutas.e2e-spec.ts` falla si falta o sobra uno.

| Decorador        | Pide                               | Contexto de tenant                   |
| ---------------- | ---------------------------------- | ------------------------------------ |
| `@Roles(...)`    | JWT y una asignación de esos roles | Usuario, rol, banco e institución    |
| `@Autenticado()` | JWT válido, con o sin asignación   | Solo `usuarioId`, si existe en SIGBA |
| `@Publico()`     | Nada                               | Ninguno                              |

`@Autenticado()` existe para quien todavía no tiene banco: la persona que
pregunta a qué bancos tiene acceso o que acepta una invitación. Quien se
registró en Auth0 sin invitación también pasa, así que estas rutas no leen
datos de ningún banco. Si el usuario no existe en SIGBA, el contexto llega
vacío y la ruta decide qué responder; la identidad verificada sigue en
`request.identidad`.

## Tiempo de una transacción de tenant

`executeTransactionWithTenant(client, fn, contextOverride?, opciones?)` y
`$transactionWithTenant(fn, contextOverride?, opciones?)` pasan `opciones` a
`$transaction` de Prisma. Sin ellas rigen los valores de Prisma: 5 s de
duración (`timeout`) y 2 s de espera por una conexión (`maxWait`). Al vencer el
`timeout`, Prisma revierte la transacción.

```ts
await executeTransactionWithTenant(this.prisma, fn, undefined, { timeout: 30_000 });
```

Sube el `timeout` solo para una tarea larga y conocida: la importación de
códigos (SBA-12) hace hasta 54 `update` en una transacción y contra Neon pide
30 s. Una transacción abierta sostiene bloqueos y una conexión del pool; una
petición HTTP normal no debería necesitarlo.

## Consumir eventos

Un consumidor implementa `ConsumidorDeEventos` y su módulo lo suscribe al
iniciar:

```ts
@Module({ providers: [IngresosConsumidor] })
export class AnaliticaModule implements OnModuleInit {
  constructor(
    private readonly despachador: DespachadorDeEventos,
    private readonly ingresos: IngresosConsumidor,
  ) {}

  onModuleInit(): void {
    this.despachador.suscribir(this.ingresos);
  }
}
```

`main.ts` arranca el sondeo después de `listen`; las pruebas y los comandos de
consola no despachan. Cada 2 s el despachador reclama hasta 50 eventos de los
tipos que alguien escucha, con lease de 60 s para que otra réplica no los tome.
Cada consumidor recibe el evento en su propia transacción, con el banco del
evento en `app.banco_id`, y en esa transacción queda su acuse en
`core.evento_consumido`. Un evento repetido no vuelve a llegar al mismo
consumidor.

No hay orden garantizado. Un evento que falla se reintenta más tarde y puede
llegar después de un evento posterior del mismo agregado, así que un
consumidor no puede depender del orden de llegada. Si necesita un evento
anterior que todavía no llegó, lanza y espera su reintento.

Si un consumidor falla, los demás conservan su acuse y el evento se reintenta
tras 5 s, 10 s, 20 s… hasta 10 min. El intento se cuenta al reclamar: un evento
que tumba el proceso también los agota. Tras 10 intentos queda en la cola
muerta:

```sql
SELECT id, banco_id, tipo, intentos, ocurrido_en FROM core.outbox
WHERE publicado_en IS NULL AND intentos >= 10;
```

El log de cada fallo lleva consumidor, id y tipo del evento, nunca la carga.
Para devolverlo a la cola, corrige el consumidor y pon `intentos = 0`.

`core/` es ruta con CODEOWNER: todo cambio pasa por revisión de arquitectura
(Arquitectura 5.2).
