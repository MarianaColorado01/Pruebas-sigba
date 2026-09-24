# SBA-14 · Cobertura de SIPSA-P sobre el catálogo del Banco

Entregable de [SBA-14](https://linear.app/iuva/issue/SBA-14). Mide qué parte del
catálogo del Banco tiene precio mayorista en SIPSA-P (DANE), para saber cuánto del
maestro de precios se puede automatizar y cuánto queda en remisión o carga manual.

| Archivo                                                      | Qué es                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| [SBA-14_Cobertura_SIPSA-P.pdf](SBA-14_Cobertura_SIPSA-P.pdf) | Informe: acceso y licencia de la fuente, metodología, resultados, mapeo, limitaciones y recomendación.     |
| [SBA-14_mapeo_sipsa.csv](SBA-14_mapeo_sipsa.csv)             | El mapeo producto → serie SIPSA de las 54 referencias, con cobertura, mercado preferido y fuente por fila. |

El informe se genera a partir del CSV, así que los dos dicen lo mismo.

## Resultado

De 54 referencias, 38 tienen serie directa, 4 tienen una aproximada y 12 no tienen
ninguna: la cobertura útil es del 78 %.

| Categoría                           | Referencias | Cubierto | Parcial | Sin cobertura | % útil   |
| ----------------------------------- | ----------- | -------- | ------- | ------------- | -------- |
| Granos                              | 12          | 11       | 1       | 0             | 100 %    |
| Dulces                              | 10          | 7        | 1       | 2             | 80 %     |
| Aseo                                | 8           | 0        | 0       | 8             | 0 %      |
| Fruta y verdura                     | 16          | 15       | 1       | 0             | 100 %    |
| Panadería                           | 5           | 2        | 1       | 2             | 60 %     |
| Lácteos y huevos (extensión equipo) | 3           | 3        | 0       | 0             | 100 %    |
| **Total**                           | **54**      | **38**   | **4**   | **12**        | **78 %** |

Lo que no tiene serie es casi todo aseo (SIPSA-P solo cubre alimentos) y pan fresco;
el resto son mermeladas y confites.

**Recomendación para ADR-13:** usar SIPSA-P como fuente automática del puerto
`FuentePrecios` para lo agroalimentario, con mercado preferido Pereira · Mercasa y
respaldo en La 41. Aseo, pan del día y lo que no tenga serie se valoran por remisión
del donante o carga manual con evidencia. El adaptador es SBA-54.

**Licencia:** las
[condiciones de SIPSA-P](https://microdatos.dane.gov.co/index.php/catalog/776)
permiten usar los datos citando «Fuente: Departamento Administrativo Nacional de
Estadística: www.dane.gov.co». Copiarlos en un medio electrónico que los deje
disponibles para múltiples usuarios exige el visto bueno escrito del DANE. SIGBA
consume y cita la fuente en cada precio que deriva de ella; no republica la base.

## Límites

- **El catálogo cruzado es del equipo, no del Banco.** Cuando se hizo, los códigos
  del Banco no habían llegado. Llegaron después y quedaron en SBA-12
  (`apps/api/prisma/datos/codigos-banco.csv`, 54 códigos). Las categorías del
  informe (granos, dulces…) son las del glosario de Arquitectura y no coinciden con
  esos códigos, así que el porcentaje por categoría hay que recalcularlo sobre la
  hoja real.
- **El 78 % es cobertura de catálogo, no de cotización.** Mide si existe la serie,
  no si se cotizó esa semana en Pereira. Eso se mide en SBA-54, sobre varias semanas
  del servicio web.
