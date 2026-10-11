# Idempotencia de comandos: `core.comando_procesado`

Toda escritura de negocio registra `(banco_id, comando_id)` y el hash de la
carga (Arquitectura 6.1). El celular reenvía comandos cuando pierde la
respuesta; sin esta clave el reenvío duplica inventario. `core` lo resuelve una
vez para recepciones, salidas, traslados y lo que venga (SBA-69).

## Qué se guarda

Una fila por comando procesado: banco, `comando_id`, versión y hash SHA-256 de
la carga, y el resultado como referencia (`entidad`, `entidad_id`). La carga
no se guarda, para que no entren datos personales a `core` (Arquitectura 8.6).

La tabla es append-only y tiene RLS por banco con FORCE. `sigba_app` solo la
lee; escribe a través de `core.reclamar_comando`, una función
`SECURITY DEFINER` que toma el banco del contexto de la transacción y nunca de
un argumento.

## Cómo se usa

`IdempotenciaService.reclamar(tx, comando)` va en `repositories/`, porque
recibe el cliente de Prisma (regla 4 del lint), al principio de la transacción
de la escritura, con el mismo `tx` de `executeTransactionWithTenant`. El id de
la entidad se genera antes, porque la reserva lo guarda:

```ts
const recepcionId = randomUUID();
return executeTransactionWithTenant(this.prisma, async (tx) => {
  const previo = await this.idempotencia.reclamar(tx, {
    comandoId,
    carga,
    resultado: { entidad: 'recepcion', entidadId: recepcionId },
  });
  if (previo) return leerRecepcion(tx, previo.entidadId);

  // ... recepción, lotes, movimientos, auditoría y outbox con este `tx`
});
```

- Comando nuevo: devuelve `null` y deja la reserva. Si la escritura revierte,
  la reserva revierte con ella.
- Mismo comando y misma carga: devuelve la referencia guardada. El llamador no
  escribe nada, tampoco auditoría.
- Mismo comando y otra carga, o el mismo `comando_id` en otra entidad:
  `ConflictException` (409).
- Dos envíos simultáneos: el segundo espera en el `INSERT` a que el primero
  termine y sale por la rama del reenvío. Solo uno escribe.

Supuestos:

- La transacción corre en READ COMMITTED, el nivel por defecto. Con
  `isolationLevel` más estricto, el segundo envío simultáneo falla con un error
  de serialización en vez de salir por la rama del reenvío.
- El segundo envío espera mientras el primero escribe. Si eso supera el
  timeout de la transacción interactiva de Prisma (5 s), recibe P2028 y el
  celular reintenta; el reintento ya sale por la rama del reenvío.
- Las validaciones que viven en otros servicios abren su propia transacción.
  Si se hacen antes de `reclamar`, un reenvío después de desactivar, por
  ejemplo, el donante responde 404 aunque la escritura original quedó. El
  consumidor decide el orden y lo deja escrito.
- La respuesta del reenvío es la entidad en su estado actual, no una copia de
  la respuesta original.

`carga` es lo que el cliente mandó, ya validado y sin campos que el servidor
calcule. El hash se calcula sobre JSON con las claves ordenadas, así que el
orden de las claves no cuenta y el de los arreglos sí. Es JSON plano: `Map`,
`Set`, `BigInt` y `undefined` no se normalizan. El SHA-256 no lleva llave, así
que la carga no puede llevar datos personales: un documento de 10 dígitos se
recupera por diccionario. Un comando de beneficiarios que los necesite pide
una versión nueva con HMAC por banco.

## Versión del hash

Cada fila guarda la versión de la normalización con que se calculó su hash.
En un reenvío, el servicio recalcula el hash con la regla de esa versión antes
de comparar. Para cambiar la regla se agrega una versión nueva en
`NORMALIZACIONES` y la anterior se deja intacta; si se reemplazara, un reenvío
de un comando viejo recibiría un 409 falso.

## Pendiente

- La retención de la tabla se decide antes de datos reales (anexo B de
  Arquitectura). El trigger append-only bloquea el borrado también al dueño.
- `core.verificar_politicas_rls()` no revisa el schema `core`; el RLS de esta
  tabla lo cubre `apps/api/test/idempotencia.integracion.spec.ts`.
