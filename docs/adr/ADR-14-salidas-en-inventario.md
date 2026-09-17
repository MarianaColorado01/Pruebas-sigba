# ADR-14 · Salidas en inventario; beneficiarios sin movimientos

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

La versión 0.1 ubicaba entregas en `beneficiarios`. El cliente describe una
salida por lote hacia una institución, con aporte y despachador. `inventario` ya
controla existencias y movimientos.

## Decisión

`inventario` registra la salida completa; `beneficiarios` expone
`InstitucionesService` de solo lectura. M2 consume `SalidaRegistrada` para
estimar cobertura, **sin generar movimientos ni descontar stock**.

Ubicar el descuento en M2 repartiría la misma regla transaccional entre equipos.

## Consecuencias

M1 confirma inventario; M2 caracteriza población y estima cobertura; M3 exporta
el reporte.

Desactivar una institución no borra salidas.

La regla aceptada cruza membresía vigente en la fecha de salida, con
deduplicación por persona, banco y período. **El resultado no acredita entrega
individual.**

RF-M2-12 tiene prioridad _Must_ como dependencia del reporte _Must_ de M3.
