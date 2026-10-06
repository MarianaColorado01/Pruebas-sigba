# SBA-8: pendientes de Auth0 y resolución de identidad

Estado revisado el 1 de octubre de 2026 sobre `ea39b75` (`Tenant de Auth0 y adaptador OIDC en core`). Este documento registra lo que falta para aceptar la historia; no confirma configuración de servicios externos ni migraciones aplicadas.

## Pendientes

### Tenant, SPA, API y staging

El `.env.example` contiene placeholders para el issuer, audience y client ID. `AuthProvider` configura el SDK con `cacheLocation="memory"` y `LoginButton` permite iniciar sesión, pero no hay evidencia de un tenant institucional, de una API con identifier creado, de dominios permitidos para staging ni de una prueba de login contra staging. El componente observado tampoco presenta una acción de logout.

Completar con la cuenta institucional: tenant y propietarios, aplicación SPA, API con audiencia propia, callback/logout/web origins exactos, RS256, refresh-token rotation y variables de staging. MFA queda opcional según la decisión del Banco y la universidad. No guardar secretos en el repositorio.

### Prisma, usuario y migración

`apps/api/src/core/prisma/prisma.service.ts` no usa el cliente Prisma generado: declara un `PrismaClientLike` local cuyo `usuario.findUnique()` siempre devuelve `null`. `apps/api/prisma/schema.prisma` define `Usuario` con `auth0_sub`, `correo` y `banco_id`, pero no con `emisor` ni clave compuesta `(emisor, auth0_sub)`. En el commit revisado no hay migración que cree o modifique esa tabla.

Reemplazar el stub por Prisma real, decidir el modelo global de usuario y aplicar una migración compatible con el lookup pre-tenant. La resolución debe probarse con el rol real de API sin propiedad de tabla ni `BYPASSRLS`.

### Identidad y autorización

`JwtStrategy.validate()` consulta Prisma dentro de la estrategia y devuelve un objeto con `id`, `auth0_sub`, `banco_id`, `roles` e `institucion_id`. Passport coloca ese resultado en `request.user`; el contrato requerido para el guard de roles es `request.identidad = { auth0Sub }`, con el emisor validado como campo adicional. Los roles deben salir de SIGBA, no de claims de Auth0.

`CoreModule` provee `JwtAuthGuard`, pero `AppModule` no lo registra como `APP_GUARD`. En el código revisado no hay guard global de roles, marca `@Publico()` ni una marca pública en el controlador de health. Añadir autenticación global antes de roles, marcar health como público y hacer que la cobertura de rutas exija `@Roles()` o `@Publico()`.

### Pruebas de aceptación

`apps/api/src/core/auth/jwt.strategy.spec.ts` simula Prisma y cubre `validate()`. No acredita la verificación criptográfica del JWT ni el comportamiento con JWKS. `apps/api/test/app.e2e-spec.ts` solo comprueba health y el prefijo; no hay prueba de inventario de metadata de rutas. No se encontró una prueba RLS para el lookup del usuario.

Agregar pruebas con JWKS local y claves sintéticas: token válido, expiración, firma alterada, audiencia/emisor erróneos, algoritmos no permitidos, ID token y cabecera ausente/mal formada. Los rechazos deben responder 401 sin consulta a Prisma. Añadir e2e con PostgreSQL y rol real para resolver usuario y asignación/banco, además de la prueba de cobertura de rutas.

### `TenantContext.usuarioId` y SBA-21

El contrato de `TenantContext.usuarioId` y su propagación a auditoría/outbox no aparece implementado en esta revisión. La propuesta es usar el UUID interno de `plataforma.usuario`, en vez del `sub` de Auth0, para no atar auditoría al proveedor. SBA-21 debe validar la decisión antes de cerrar el contrato.

## Evidencia y límites

La revisión inspeccionó el árbol del repositorio en `ea39b75`. No tuvo acceso al tenant institucional, a staging ni a una base de datos PostgreSQL configurada. Por tanto, no afirma que la configuración externa esté ausente; afirma que el repositorio no aporta evidencia de ella. Las pruebas y migraciones descritas arriba siguen pendientes de ejecución y verificación.