# Operación sin señal

Aquí vive la cola local de comandos, la caché versionada del catálogo y la
reconciliación al sincronizar (Arquitectura 5.3 y 8.4, ADR-10).

`catalogoDb.ts` guarda una copia del catálogo por banco con su ETag (SBA-22). La
pantalla la valida al abrir y avisa «posiblemente desactualizado» mientras
muestra la copia sin confirmar con la API. El catálogo no trae datos personales.

`stockDb.ts` guarda, por banco, el último stock que respondió la API y la hora
en que lo recibió el dispositivo (SBA-36). Vive en su propia base, `sigba-stock`,
para no tocar el esquema de `sigba-offline`. Tampoco trae datos personales.

## Cola de comandos

`colaDb.ts` guarda los comandos de inventario en su propia base, `sigba-cola`,
con `comandoId` UUIDv7, banco, usuario (`sub` de Auth0), carga y estado:

- `pendiente`: guardado en el celular, sin respuesta de la API.
- `enviado`: salió hacia la API. Si la app se cierra antes de la respuesta,
  vuelve a enviarse; la API lo reconoce por su `comandoId` (Arquitectura 6.1).
- `confirmado`: la API respondió 200 o 201.
- `conflicto`: la API lo rechazó (409, validación o regla de negocio). Se guarda
  con el motivo y no se borra; la coordinación lo concilia (RF-M1-11).

`RUTA_DE_COMANDO` es la lista cerrada de comandos que acepta la cola. Solo
entran comandos de inventario: nada con datos personales de beneficiarios.

`sincronizar.ts` envía en orden de creación los comandos de la persona en el
banco activo. Sin red o con un 5xx, el comando sigue pendiente y se reintenta
a los 2, 4, 8… segundos, hasta un minuto. Con la sesión vencida la cola se
detiene sin contar el intento y sigue cuando la persona vuelve a entrar.

`app/ColaProvider.tsx` sincroniza al abrir la app, al encolar, al volver la red
(sin esperar el reintento) y al recuperar la sesión. Una pantalla usa la cola
así:

```ts
const { encolar, comandos } = useCola();
// carga sin comandoId; el comandoId es opcional y se conserva entre reintentos
const { comandoId } = await encolar('recepcion', carga, comandoId);
const estado = comandos.find((c) => c.comandoId === comandoId)?.estado;
```

La pantalla `/sincronizacion` lista lo pendiente y lo que está en conflicto.

Un registro local **no confirma inventario en el servidor**. La interfaz debe
decir «pendiente de sincronizar» hasta que la API responda.
