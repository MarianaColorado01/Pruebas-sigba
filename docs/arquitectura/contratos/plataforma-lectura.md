# Contrato de lectura de plataforma (SBA-34)

Plataforma es dueña de `plataforma.bodega` y `plataforma.parametro_banco`. Inventario (M1)
y beneficiarios (M2) los leen con dos servicios de solo lectura que exporta
`apps/api/src/modules/plataforma/index.ts`. Ninguno escribe, emite eventos ni recibe el
banco por parámetro: el banco sale del contexto de tenant y RLS filtra cada consulta.
Los consumidores guardan solo el id, sin FK hacia el schema `plataforma` (ADR-05).

Para usarlos, el módulo importa `PlataformaModule` y pide el servicio por inyección:

```ts
import { BodegasService, ParametrosLectura, PlataformaModule } from '../plataforma/index.js';
```

## Consumidores

| Módulo           | Lee                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| M1 inventario    | bodegas, `aporte_solidario_pct`, `semaforo_rojo_dias`, `semaforo_amarillo_dias`, `recordatorio_borrador_horas` |
| M2 beneficiarios | `rangos_etarios`, `retencion_dias`                                                                             |

## BodegasService

```ts
listarActivas(): Promise<BodegaLectura[]>
obtenerPorId(id: string): Promise<BodegaLectura | null>
obtenerActiva(id: string): Promise<Bodega>   // 404 si no existe o está inactiva

interface BodegaLectura { id: string; nombre: string; direccion: string | null; activa: boolean }
interface Bodega { id: string; nombre: string }
```

- `listarActivas` devuelve las bodegas con `activa = true` del banco del contexto, ordenadas
  por nombre y luego por id.
- `obtenerPorId` devuelve la bodega aunque esté inactiva, con `activa: false`. Sirve para
  mostrar movimientos viejos. Devuelve `null` si el id no existe o es de otro banco.
- `obtenerActiva` valida la bodega de un movimiento nuevo: responde 404 si no existe, es de
  otro banco o está inactiva.
- Sin banco en el contexto, los tres lanzan error.

## ParametrosLectura

```ts
consultarVigente<K extends ClaveParametroLectura>(clave: K, fecha: Date): Promise<ResultadoParametro<K>>

type ClaveParametroLectura = Exclude<ClaveParametro, 'factor_minorista'>;

type ResultadoParametro<K> =
  | { encontrado: true; clave: K; valor: ValorParametro[K]; parametroId: string;
      version: number; fechaInicio: string; fechaFin: string | null }
  | { encontrado: false; clave: K; motivo: 'SIN_VALOR_VIGENTE'; fecha: string };
```

`ClaveParametro`, `ValorParametro`, `ClaveParametroLectura`, `ResultadoParametro` y
`BodegaLectura` viven en `@sigba/shared-types` y el `index.ts` de plataforma los reexporta.

### Vigencia

- Cada versión rige en el intervalo cerrado `[fechaInicio, fechaFin]`, en días calendario
  de Bogotá (`YYYY-MM-DD`). `fechaFin` nula significa vigencia abierta.
- `consultarVigente` convierte la `Date` recibida al día de Bogotá (UTC−5). Por ejemplo,
  `2026-10-01T03:00:00Z` es todavía el 30 de septiembre en Bogotá.
- Al publicar una versión nueva, la anterior se cierra el día antes de que empiece la
  nueva. Si la v1 rige hasta el 2026-09-30 y la v2 desde el 2026-10-01, consultar el 30
  devuelve la v1 y consultar el 1 de octubre devuelve la v2.
- La base impide vigencias solapadas por banco y clave (`parametro_banco_sin_solapamiento`).

### Sin valor vigente

Si no hay versión vigente ese día, o la clave nunca se configuró, la respuesta es
`{ encontrado: false, motivo: 'SIN_VALOR_VIGENTE', fecha }`. No hay valor por defecto:
nunca se devuelve 0 ni un objeto vacío. El consumidor decide qué hacer, por ejemplo dejar
el cálculo pendiente.

Sin banco en el contexto de tenant, `consultarVigente` lanza error antes de consultar la
base, igual que `BodegasService`. Con RLS esa consulta devolvería cero filas, y no debe
confundirse con «sin valor vigente».

### Errores

- `ValorParametroAlmacenadoInvalido` (`clave`, `parametroId`): el valor guardado no cumple
  la forma de su clave.
- `VigenciaDuplicada` (`clave`, `fecha`, `parametroIds`): hay más de una versión vigente ese
  día. La restricción de la base lo impide, así que indica datos corruptos. No se elige
  ninguna de las versiones.

Los dos responden 500 por HTTP y se reportan como errores del sistema.

### Claves y unidades

| Clave                         | Tipo                                         | Unidad y reglas                                                                   |
| ----------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `aporte_solidario_pct`        | `number`                                     | Porcentaje entre 0 y 10, inclusive. `8` es 8 %.                                   |
| `semaforo_rojo_dias`          | `number`                                     | Días, entero mayor que 0.                                                         |
| `semaforo_amarillo_dias`      | `number`                                     | Días, entero mayor que 0.                                                         |
| `rangos_etarios`              | `{ desde: number; hasta: number \| null }[]` | Edad en años, enteros. Ordenados, sin solaparse; `hasta: null` solo en el último. |
| `recordatorio_borrador_horas` | `number`                                     | Horas, entero mayor que 0.                                                        |
| `retencion_dias`              | `number`                                     | Días, entero mayor que 0.                                                         |

### Trazabilidad

Todo movimiento o cálculo que use un parámetro guarda el `parametroId` devuelto
(Arquitectura 8.7). Así se puede reconstruir con qué versión se calculó, aunque después
se publique otra.

### Método anterior

`obtenerVigente(clave, fecha?: string): Promise<ParametroVigente | null>` sigue disponible
y sin cambios. Está marcado `@deprecated`: no devuelve el id de la versión ni valida el
valor guardado. Hoy lo usan `salidas.service` y `stock.service` de inventario.

## Pendientes de acordar con capitanes

- **Migrar de `obtenerVigente` a `consultarVigente`.** Inventario cambia `salidas.service`
  y `stock.service`, y los dobles de prueba que heredan de `ParametrosLectura`. Cuando no
  quede ningún consumidor, plataforma borra el método anterior. Mientras tanto,
  `ParametrosLectura.consultarVigente` trae una implementación que rechaza la llamada, para
  que esos dobles compilen; el servicio real la sobrescribe.
- **`factor_minorista` queda fuera del contrato de lectura.** Se puede administrar y
  consultar por HTTP, pero ningún módulo lo lee por este servicio hasta que se acuerde quién
  lo consume y en qué unidad.
- **Formato de `rangos_etarios`.** El código tiene un TODO de SBA-20: el Banco todavía no
  define sus rangos. Falta confirmar que la unidad es años cumplidos y si los rangos deben
  ser contiguos. Hoy se permiten huecos entre ellos.
- **Alcance de `retencion_dias`.** Es un solo número por banco. Falta confirmar a qué datos
  de M2 aplica y si basta un plazo único.
- **Coherencia del semáforo.** Rojo y amarillo son dos claves con vigencias independientes,
  y nada exige que amarillo sea mayor que rojo. Falta decidir si se validan juntas o si M1
  tolera combinaciones incoherentes.
