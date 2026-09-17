# ADR-06 · Auth0 para identidad, autorización propia

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

El equipo no construirá almacenamiento de contraseñas. Los usuarios externos
necesitan identidad y permisos por institución. El stack acordado incluye Auth0.

## Decisión

Auth0 autentica; SIGBA guarda emisor y `sub`, roles, banco e institución. La API
valida access tokens y permisos vigentes.

Guardar roles solo en Auth0 acopla reglas del dominio al proveedor. Supabase
Auth ofrece identidad administrada, pero cambiaría la decisión de stack sin una
comparación de costos ni migración demostrada.

## Consecuencias

Un proveedor OIDC alternativo exige migrar identidades, sesiones y
configuración, además del adaptador.

Confirmar plan, usuarios activos, invitaciones y MFA antes de comprometer
costos.

La PWA usa el SDK y tokens en memoria; espera reautenticación para sincronizar
[F10].
