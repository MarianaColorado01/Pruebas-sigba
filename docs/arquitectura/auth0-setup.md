# Configuración de Auth0

Un tenant institucional autentica a las personas de toda la red. Auth0 emite tokens; SIGBA conserva la identidad externa y decide roles, bancos e instituciones desde PostgreSQL. No crear roles ni permisos en Auth0.

## Tenant y aplicaciones

La universidad debe crear o asignar el tenant institucional. La cuenta propietaria, sus administradores y el plan quedan por confirmar. No registrar secretos del tenant en Git.

1. En Auth0, crear una aplicación **Single Page Application** para SIGBA.
2. Configurar **Allowed Callback URLs** con `http://localhost:5173` y el origen exacto de Cloudflare Pages para staging. Agregar producción solo cuando exista su dominio.
3. Configurar **Allowed Logout URLs** y **Allowed Web Origins** con los mismos orígenes. No usar comodines en staging o producción.
4. Copiar el dominio y el client ID a `VITE_AUTH0_DOMAIN` y `VITE_AUTH0_CLIENT_ID`.
5. Crear una API con un identifier propio, por ejemplo `https://api.sigba.example`. El identifier debe coincidir exactamente con `AUTH0_AUDIENCE` y `VITE_AUTH0_AUDIENCE`.
6. Configurar la firma de la API como **RS256**. Mantener desactivada la asignación de roles y permisos en Auth0.
7. En la API, activar **Allow Offline Access**. Sin esa opción Auth0 ignora el scope `offline_access` que pide la PWA, no emite refresh token y la sesión se cae cuando vence el access token.
8. Activar **Refresh Token Rotation** para la SPA. La PWA usa el SDK con `cacheLocation: "memory"`; no cambiarlo a almacenamiento persistente.
9. Fijar las vigencias. El access token se define en la API (**Maximum Access Token Lifetime**). El refresh token se define en la aplicación (**Absolute Lifetime** e **Inactivity Lifetime**, con **Refresh Token Expiration** activado). Un access token corto limita lo que vale uno robado; el refresh token decide cada cuánto el operario vuelve a iniciar sesión para sincronizar. Valores del piloto [por verificar].
10. MFA puede habilitarse como política del tenant si la universidad lo aprueba. El piloto no exige MFA.
11. Crear usuarios de prueba sintéticos y asignar roles operativos desde SIGBA, no desde claims de Auth0.

La API acepta solicitudes de navegador desde los orígenes exactos de `CORS_ORIGINS`, separados por coma. En local usa `http://localhost:5173`; en staging agrega el hostname exacto de Cloudflare Pages. No configures comodines.

El issuer termina en `/`. Para el tenant `tenant-institucional.us.auth0.com`, configurar:

```dotenv
AUTH0_ISSUER_URL=https://tenant-institucional.us.auth0.com/
AUTH0_AUDIENCE=https://api.sigba.example
VITE_AUTH0_DOMAIN=tenant-institucional.us.auth0.com
VITE_AUTH0_CLIENT_ID=<client-id-de-la-spa>
VITE_AUTH0_AUDIENCE=https://api.sigba.example
```

La API deriva el JWKS del issuer (`<issuer>.well-known/jwks.json`) y rechaza al arrancar un issuer que no sea HTTPS. El client ID de la SPA es público; no añadir client secrets a la PWA.

## Identidad y RLS

La API valida firma, `iss`, `aud`, expiración y `RS256` con JWKS remoto. La audiencia de API impide usar un ID token dirigido al client ID como credencial de la API. El guard no consulta PostgreSQL: ante un token inválido responde 401 antes de resolver la identidad.

`plataforma.usuario` conserva UUID interno, `emisor`, `auth0_sub`, estado y fechas. La clave única es `(emisor, auth0_sub)`. Las columnas preexistentes `email` y `nombre` se mantienen hasta que el Equipo 3 confirme el modelo de invitaciones de SBA-19. La función `plataforma.resolver_usuario_auth0(text, text)` consulta la identidad con `SECURITY DEFINER` y `search_path` fijo; su propietario `sigba_identity_lookup` no tiene login ni `BYPASSRLS`. El rol de API ejecuta la función y no lee directamente `usuario`.

`DATABASE_URL` identifica la conexión administrativa para migraciones y seed. La API usa `API_DATABASE_URL` con el rol `sigba_app`, que no es superusuario y no elude RLS. Sus privilegios, incluido `EXECUTE` sobre `plataforma.resolver_usuario_auth0`, están en `apps/api/prisma/roles/rol-de-api.sql`. Cómo se aplican y cómo se le pone la clave está en [rol-de-api.md](rol-de-api.md).

El resolutor no crea usuarios. Si Auth0 entrega un `sub` que SIGBA no conoce, la API rechaza el acceso hasta que una invitación o un administrador registre la identidad y su asignación. Para una cuenta sintética de staging, conéctate con `DATABASE_URL`, el dueño de las tablas, y asocia el `iss` y `sub` exactos de Auth0. En Neon el dueño no es superusuario; puede escribir en `usuario` por la política `usuario_administracion`, que solo aplica al rol que corrió la migración:

```sql
INSERT INTO plataforma.usuario (emisor, auth0_sub, email, nombre)
VALUES (
	'https://tenant-institucional.us.auth0.com/',
	'<sub-sintetico>',
	'<correo-sintetico-unico>',
	'Usuario sintético'
)
ON CONFLICT (emisor, auth0_sub) DO UPDATE SET activo = true
RETURNING id;
```

Usa el UUID devuelto para crear `plataforma.usuario_rol` con un rol y banco de staging. No copies `email` ni `nombre` desde claims del token. No ejecutes estas sentencias con `API_DATABASE_URL`.

La migración asigna a filas antiguas un issuer legado no autenticable porque el tenant anterior no está confirmado. No se debe reemplazar ese valor por el issuer nuevo sin validar cada cuenta y su vínculo con el usuario.

`TenantContext.usuarioId` contiene el UUID interno de `plataforma.usuario`. Los comandos usan `TenantContext.actor` para su etiqueta técnica; esa etiqueta no se fija en `app.usuario_id`. El `sub` y el issuer identifican al proveedor, no a la fila local.

## Verificación en staging

No hay acceso desde este repositorio al tenant institucional ni a staging. Antes de activar usuarios reales, completar estas comprobaciones con datos sintéticos:

- Confirmar callback, logout y web origins para `localhost:5173` y el hostname exacto de Cloudflare Pages.
- Iniciar sesión y recargar la PWA. La aplicación puede pedir autenticación otra vez; confirmar que no guarda tokens en `localStorage`, `sessionStorage` ni IndexedDB y que conserva los comandos pendientes.
- Llamar con el SDK a una ruta protegida que tenga `@Roles()`; confirmar que la solicitud lleva `Authorization: Bearer` y recibe respuesta autorizada.
- Llamar la misma ruta sin token y con un token de otra audiencia; ambos casos deben responder 401. `/api/v1/health` es pública y no sirve para validar el guard.
- Cerrar sesión y confirmar el retorno al origen configurado.
- Interrumpir la renovación del access token; confirmar que la PWA informa que requiere autenticación y conserva los comandos offline pendientes.
- Revisar logs y Sentry para confirmar que no incluyen tokens, cabeceras `Authorization` ni claims personales.

## Preguntas abiertas

- ¿Qué cuenta institucional será propietaria del tenant y quiénes serán sus administradores? [por verificar]
- ¿Qué plan, límite de usuarios activos, flujo de invitaciones y política MFA usará el piloto, y cuál será su costo? [por verificar]
- ¿Debe `plataforma.usuario` conservar `email` y `nombre` para invitaciones y administración de usuarios? La migración no debe borrar esos datos hasta que el Equipo 3 confirme el modelo.
- ¿Cuáles son los dominios definitivos de staging y producción? [por verificar]
