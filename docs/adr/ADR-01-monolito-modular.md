# ADR-01 · Monolito modular

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

Catorce estudiantes en tres equipos disponen de doce semanas. El inventario
exige confirmar salida, movimientos y eventos en una transacción. El presupuesto
cubre seis meses; el soporte y la financiación después de febrero de 2027 siguen
por definir.

## Decisión

Mantener un proceso NestJS con módulos y contratos públicos.

Tres APIs con RabbitMQ y AKS añaden despliegues, autenticación entre servicios y
fallos distribuidos sin una necesidad de escala demostrada. Un monolito sin
fronteras reduce el arranque, pero permite escrituras e importaciones cruzadas
que dificultan el trabajo de los tres equipos.

## Consecuencias

El equipo comparte pipeline y despliegue, con riesgo de afectar todos los
módulos en una release. Staging y pruebas reducen ese riesgo.

Extraer un módulo exige revisar contratos, datos, transporte, secretos y
operación; no basta con mover una carpeta.
