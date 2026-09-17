# ADR-02 · PWA separada de la API

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

El docente exige separar frontend y backend. La bodega usa celulares con señal
inestable y el piloto no incluye una aplicación nativa.

## Decisión

React y Vite producen una PWA que consume la API REST de NestJS bajo `/api/v1`.
OpenAPI describe el contrato.

Un frontend acoplado al servidor incumple la restricción; una aplicación nativa
agrega distribución y mantenimiento fuera del piloto.

## Consecuencias

Los equipos desarrollan interfaz y API en paralelo.

La instalación de una PWA no garantiza trabajo sin señal: el equipo debe probar
caché, cola, reautenticación y almacenamiento en los celulares del Banco.
