# ADR-13 · Maestro de precios con varias fuentes y aprobación mensual

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

El Banco cuenta producto y presentación, sin separar marcas: arroz Diana de
500 g y arroz D1 de 500 g comparten referencia y precio vigente. Las remisiones
conservan evidencia, pero no siempre expresan precio comercial. SIPSA-P incluye
algunos abarrotes y procesados según producto, mercado y período [F5]. La
aplicación registrada de Mercado Libre no acredita búsqueda global para SIGBA
[F1, F2].

## Decisión

`FuentePrecios` prioriza evidencia comparable:

1. Remisión o factura con naturaleza del valor, fecha y presentación validadas.
2. SIPSA-P con mapeo comprobado y atribución DANE.
3. Catálogo de proveedor, donante o red con permiso.
4. Captura manual documentada.

La calidad y vigencia prevalecen sobre el orden. Las observaciones alimentan
producto y presentación genéricos, sin exigir marca. **El piloto excluye
búsqueda global y scraping de Mercado Libre.**

### Control

Cada observación conserva descripción, precio y unidad originales, moneda,
fecha, mercado, fuente, evidencia, mapeo y método. La propuesta normaliza el
valor por presentación e incluye piso, techo y muestra. La coordinación revisa
cada mes y aprueba, corrige o rechaza con motivo. Cada referencia genérica tiene
una versión vigente; los movimientos conservan la versión aplicada.

Convertir un precio por kg a 500 g es una equivalencia por peso, no una
observación minorista del paquete. Cualquier factor minorista exige evidencia y
aprobación.

## Alternativas y consecuencias

El IPC publica índices, no un catálogo de precios COP por presentación [F7]. La
revisión no acreditó una fuente automática con cobertura suficiente para todos
los abarrotes, aseo y no alimentos del Banco.

Scraping sin permiso agrega riesgo de acceso y mantenimiento; un futuro ensayo
exige revisar términos y `robots` del host, calidad, bloqueo y responsable.

Ante fallo: suspender adaptador, conservar evidencia e historial, avisar sobre
antigüedad y recurrir a las demás fuentes o carga manual.

La recepción sin precio confirma cantidades con valoración pendiente. La
coordinación aprueba antes del aporte; los equipos preservan la valoración
tardía sin editar movimientos.

Vigencia, bandas y criterio contable siguen pendientes. El anexo D del documento
de arquitectura recoge la investigación.
