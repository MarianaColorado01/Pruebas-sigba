# Auditoría consultable y registro de lecturas

SBA-51 deja a `admin_banco` y a coordinación consultar quién hizo qué y cuándo
en su banco, incluida cada lectura de datos personales (RF-M3-05, RNF-04).
Arquitectura 8.6 pide que la auditoría registre actor, finalidad, entidad
consultada, fecha y resultado sin copiar la ficha personal. Este documento
fija cómo.

## Lecturas: `AuditService.registrarLectura`

`core` expone un método aparte para las lecturas, con la acción `leer`:

```ts
await this.auditoria.registrarLectura(tx, {
  entidad: 'beneficiario',
  conjunto: `beneficiarios_de_institucion:${institucionId}`,
  cantidad: filas.length,
  finalidad: 'entrega_de_mercado',
});
```

- `conjunto` va en `entidad_id`. Solo admite un código en minúsculas seguido de
  UUID separados por `:`. Un nombre, un documento o un texto de búsqueda no
  pasan la validación y el método lanza antes de escribir.
- `cantidad` es el número de filas que salen hacia quien consultó, y va en
  `detalle.cantidad`. El contenido leído nunca entra.
- `finalidad` es obligatoria y también es un código, no texto libre.
- Se llama dentro de la misma transacción que lee, con el mismo `tx` de
  `executeTransactionWithTenant`, después de la consulta. Si la lectura falla,
  no queda registro; si el registro falla, la consulta tampoco responde.

### Lo que debe llamar el equipo 1

Cada repositorio de `beneficiarios` que devuelva datos personales llama a
`registrarLectura` antes de devolver. Para la lista de beneficiarios de una
institución (SBA-27), en `repositories/`:

```ts
return executeTransactionWithTenant(this.prisma, async (tx) => {
  const beneficiarios = await tx.beneficiario.findMany({ where: { institucionId } /* ... */ });
  await this.auditoria.registrarLectura(tx, {
    entidad: 'beneficiario',
    conjunto: `beneficiarios_de_institucion:${institucionId}`,
    cantidad: beneficiarios.length,
    finalidad: 'entrega_de_mercado',
  });
  return beneficiarios;
});
```

Las finalidades las define el equipo 1 con Cáritas. Una búsqueda por nombre o
documento registra el conjunto por la institución o por `beneficiarios_del_banco`,
nunca el término buscado.

## Usuario o sistema

La tabla ya distinguía actores desde SBA-21: `actor_tipo` es `usuario` o
`sistema`, con `actor_id` para el primero y `actor_etiqueta` para el segundo.
`core.registrar_auditoria` decide con el contexto de la transacción:

- Con `app.usuario_id`, el actor es ese usuario.
- Sin usuario, toma `app.actor` y lo registra como `sistema`.

Una tarea programada fija `actor: 'sistema:<tarea>'` en el contexto de tenant,
por ejemplo `sistema:retencion`, y no fija `usuarioId`. No hizo falta columna
nueva. La prueba de integración escribe con `sistema:retencion` y comprueba
que la consulta lo devuelve como `sistema` sin `actorId`.

## Consulta HTTP en `plataforma`

Vive en `modules/plataforma`: controlador, servicio y un repositorio de solo
lectura sobre `core.auditoria`. El banco no se filtra en el SQL; lo pone la
política RLS `auditoria_banco_select` con el `app.banco_id` de la transacción.

`sigba_app` ya tenía `GRANT SELECT` sobre `core.auditoria` y la política de
lectura por banco desde la migración `20261006120000_core_auditoria`, así que
SBA-51 no trae migración ni cambia `rol-de-api.sql`. La tabla sigue
append-only: sin `INSERT`, `UPDATE` ni `DELETE` para la API, y con los
triggers que rechazan cambios incluso al dueño.

### `GET /api/v1/auditoria`

Roles: `admin_banco` y `coordinacion`. El resto, incluido `super_admin`, recibe
403: `super_admin` no ve datos nominales de ningún banco (Arquitectura 8.6).

Filtros, todos opcionales:

| Parámetro   | Qué filtra                                                    |
| ----------- | ------------------------------------------------------------- |
| `actor`     | UUID del usuario o etiqueta de la tarea (`sistema:retencion`) |
| `tipoActor` | `usuario` o `sistema`                                         |
| `entidad`   | código de la entidad (`institucion`, `beneficiario`)          |
| `accion`    | `crear`, `actualizar`, `eliminar` o `leer`                    |
| `desde`     | instante ISO 8601, incluido                                   |
| `hasta`     | instante ISO 8601, excluido                                   |
| `cursor`    | el `siguienteCursor` de la página anterior                    |
| `limite`    | 1 a 100; 50 por defecto                                       |

Responde `PaginaDeAuditoria` de `@sigba/shared-types`, del más reciente al más
antiguo. La paginación es por cursor sobre `(ocurrido_en, id)`. El cursor
lleva el instante con microsegundos como lo guarda PostgreSQL: un `Date` de
JavaScript los recorta a milisegundos y la página siguiente se saltaría
registros del mismo milisegundo. Hay una prueba con tres registros en el mismo
instante.

`actorNombre` sale de `plataforma.usuario` con un `LEFT JOIN`. Mientras no
llegue la política de SBA-61, `sigba_app` no ve filas de `usuario` y el nombre
viene `null`; la PWA muestra el inicio del UUID. Con SBA-61 aparece el nombre
de quien tenga asignación en el banco.

### `GET /api/v1/auditoria/exportar?desde&hasta`

Solo `admin_banco`. Los dos parámetros son obligatorios y definen
`[desde, hasta)`. Devuelve CSV en UTF-8 con BOM, separado por comas, en orden
cronológico, con las columnas `ocurrido_en`, `tipo_actor`, `actor`,
`actor_id`, `accion`, `entidad`, `entidad_id`, `resultado`, `finalidad` y
`cantidad`. Una celda que empieza por `=`, `+`, `-` o `@` lleva un apóstrofo
delante para que la hoja de cálculo no la ejecute.

Un periodo con más de 50.000 registros responde 400 y pide acortar el rango:
el CSV se arma en memoria y la API comparte máquina con la analítica.

### Leer la auditoría también se audita

Cada consulta y cada exportación registran su propia lectura en la misma
transacción, con entidad y conjunto `auditoria`, la cantidad de filas
devueltas y la finalidad `consulta_de_auditoria` o `exportacion_de_auditoria`.

## PWA: `/plataforma/auditoria`

Una bitácora agrupada por día. Cada fila dice quién hizo qué
(«Marta consultó 12 registros de beneficiario») y abre el detalle en un panel
al lado; en el celular el detalle sube como hoja inferior.

- Los filtros de acción y de tipo de actor son segmentos en una barra compacta.
  El rango son dos fechas locales incluidas; la PWA las convierte en instantes
  `[inicio del primer día, inicio del día siguiente al último)`.
- Actor y entidad no tienen campo: se fijan desde el detalle de un registro
  («Solo este actor») y quedan como chips que se quitan.
- Los filtros viven en la URL, así que un enlace comparte la vista.
- El botón de exportar va dentro de `SoloPara roles={['admin_banco']}` y se
  activa cuando hay rango.
- La pantalla solo funciona en línea: la auditoría no se guarda en IndexedDB.

La ruta se registra en `app/enrutador.tsx`; el menú de navegación es de otro
ticket.

## Pruebas

- `core/auditoria/audit.service.spec.ts`: `registrarLectura` rechaza conjuntos
  con nombres, documentos o texto de búsqueda.
- `plataforma/services/consulta-de-auditoria.service.spec.ts`: cursor, rangos,
  límite y CSV.
- `test/auditoria-consultable.integracion.spec.ts`, contra PostgreSQL con el
  rol de la API y los guards reales: aislamiento entre bancos, 403 para
  `operario_bodega`, `consulta` y `super_admin`, coordinación sin exportar,
  lectura registrada sin nombres ni documentos, actor de sistema, la lectura
  de la propia auditoría, cursor y rango del CSV.
