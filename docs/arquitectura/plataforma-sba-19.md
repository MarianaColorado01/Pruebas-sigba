# Plataforma: decisiones de SBA-19 y vecinos

Fecha: 15 de octubre de 2026. Alcance: SBA-19 (red, bancos, bodegas, usuarios e
invitaciones), SBA-61 (políticas de tablas globales) y el contrato que consume
SBA-44 (portal de institución, equipo 1).

Los documentos de arquitectura y alcance dejaban estas preguntas abiertas. Cada
decisión dice qué se hace, por qué y qué la cambiaría. Si una no aguanta la
revisión, se cambia aquí y se avisa en el ticket.

## D1. Correo: el enlace es el canal, el correo es opcional

No hay cuenta de Resend. La invitación no depende de un proveedor de correo:

- La API devuelve el enlace en la respuesta de crear y de reenviar. La PWA lo
  muestra con botones de copiar y compartir (Web Share API, que en el celular
  abre WhatsApp).
- `core/correo/` tiene el puerto `EnviadorDeCorreo` y dos adaptadores:
  - SMTP genérico, activo si existen `SMTP_URL` y `CORREO_REMITENTE`. Sirve con
    Resend, Brevo o una cuenta institucional sin tocar código.
  - Nulo, cuando falta configuración. No envía nada y no escribe el enlace en
    logs.
- La respuesta trae `correoEnviado: boolean` para que la PWA diga si salió
  correo o hay que compartir el enlace a mano.

**Lo cambiaría:** que el Banco exija correo sí o sí. Basta configurar SMTP.

## D2. Alta en Auth0 sin Management API

Sin credenciales M2M ni SDK de administración:

1. La persona abre `/invitacion/:token` en la PWA.
2. La PWA llama a `loginWithRedirect` con `screen_hint: 'signup'`. Quien ya
   tiene cuenta inicia sesión normal.
3. Al volver, la PWA llama a `POST /api/v1/invitaciones/aceptar` con
   `{ token }` y el access token.
4. La API enlaza el `sub` con la invitación y crea la asignación.

Requisito en Auth0: la conexión Username-Password con registro habilitado.
Quien se registre sin invitación no tiene asignación y recibe 403, como hoy.

**Lo cambiaría:** que el Banco quiera cerrar el registro público. Entonces sí
hace falta la Management API para crear la cuenta desde SIGBA.

## D3. No se exige que el correo del token coincida

El access token no trae el correo. La credencial es el token de la invitación:
un solo uso, vencimiento corto y aceptación auditada con el `sub`. Si el enlace
llega a otra persona, el administrador lo ve en la lista (quién aceptó y
cuándo) y desactiva la asignación.

Si el usuario es nuevo, `usuario.email` y `usuario.nombre` toman los datos de
la invitación.

## D4. Token de invitación

- 32 bytes de `crypto.randomBytes`, en base64url.
- En base de datos solo va el SHA-256 en hex (`token_hash`, único).
- Vence a los 7 días. Un solo uso (`aceptada_en`). Revocable (`revocada_en`).
- Reenviar genera un token nuevo en la misma fila, reemplaza el hash y renueva
  el vencimiento. El enlace anterior deja de servir.
- Enlace: `${WEB_URL}/invitacion/${token}`. `WEB_URL` es variable nueva de la
  API.
- El token nunca va a logs, auditoría, Sentry, outbox ni mensajes de error.

## D5. Tabla `plataforma.invitacion` y aceptación

Columnas: `id`, `banco_id`, `email`, `nombre`, `rol_id`, `institucion_id`
(nula salvo rol `institucion`), `token_hash`, `vence_en`, `aceptada_en`,
`aceptada_por` (usuario), `revocada_en`, `creado_por`, `creado_en`.

RLS por `banco_id` con USING y WITH CHECK, como `bodega`.

Quien acepta todavía no tiene banco en contexto, así que la aceptación va por
una función `SECURITY DEFINER`:
`plataforma.aceptar_invitacion(token_hash text, emisor text, auth0_sub text)`.
En una transacción:

1. Busca la invitación por hash con `FOR UPDATE`.
2. Valida que exista, no esté vencida, usada ni revocada.
3. Crea el usuario por `(emisor, auth0_sub)` o reutiliza el existente.
4. Inserta la asignación en `usuario_rol`. Si ya existe activa, no duplica.
5. Marca la invitación como aceptada.
6. Fija `app.banco_id` y registra auditoría.

Devuelve `banco_id` y rol. Lleva `REVOKE ... FROM PUBLIC` en la migración y su
`GRANT EXECUTE` en `prisma/roles/rol-de-api.sql`, en el mismo PR.

Invitación inexistente, vencida, usada o revocada: 410 con un código
(`vencida`, `usada`, `revocada`, `no_existe`) para que la PWA diga qué pasó.

## D6. Rutas que exigen sesión pero no asignación

Decorador nuevo en `core/auth/autenticado.decorator.ts`: `@Autenticado()`,
metadato `SOLO_AUTENTICADO`. Exige JWT válido; `RolesGuard` no exige
asignación. `cobertura-rutas.e2e-spec.ts` pasa a exigir exactamente uno de
`@Roles`, `@Publico` o `@Autenticado`.

Lo usan dos rutas: `POST /invitaciones/aceptar` y `GET /yo/asignaciones`.

## D7. `super_admin` actúa sobre un banco concreto

`super_admin` no tiene banco en su asignación. Las funciones de auditoría,
idempotencia y outbox exigen `app.banco_id`. No se cambian esas funciones:

- Una operación de `super_admin` sobre un banco recibe el `bancoId` en la ruta
  (`/bancos/:bancoId/...`). El repositorio fija `app.banco_id` a ese banco
  dentro de la transacción.
- Crear un banco: la transacción inserta la fila y fija `app.banco_id` con el
  id nuevo antes de auditar.
- `red` no tiene escrituras desde la aplicación.

## D8. Quién invita a quién

| Quien invita   | Puede invitar                                                              | En qué banco |
| -------------- | -------------------------------------------------------------------------- | ------------ |
| `super_admin`  | `admin_banco`                                                              | Cualquiera   |
| `admin_banco`  | `admin_banco`, `coordinacion`, `operario_bodega`, `voluntario`, `consulta` | El suyo      |
| `coordinacion` | `institucion` (desde M2)                                                   | El suyo      |

- Nadie invita `super_admin` por la aplicación: se asigna por SQL.
- El "permiso expreso" del Alcance no existe en esta versión. Se concede
  asignando `admin_banco`.
- El endpoint de plataforma rechaza el rol `institucion` con 400. Esa
  invitación sale del directorio de instituciones (D9).

## D9. Contrato para M2 (SBA-44)

`plataforma/index.ts` exporta `UsuariosService` con:

```ts
invitar(entrada: {
  email: string;
  nombre: string;
  rol: Rol;
  bancoId: string;
  institucionId?: string;
}): Promise<{ invitacionId: string; enlace: string; venceEn: Date; correoEnviado: boolean }>;
```

Plataforma no valida que la institución exista: eso crearía una dependencia
de plataforma hacia beneficiarios. M2 la valida con su `InstitucionesService`
antes de llamar. Cuando M2 desactive una institución, desactiva también sus
asignaciones; el método para eso se agrega cuando M2 lo pida.

## D10. Bodega

- `nombre`: 1 a 80 caracteres, sin espacios a los lados, único por banco sin
  distinguir mayúsculas.
- `direccion`: opcional, hasta 200.
- `activa`.

Sin tipo ni código mientras nadie los pida. Lo gestiona `admin_banco`.

Se puede desactivar con stock. Deja de ofrecerse para movimientos nuevos y el
stock que tenga sigue visible. Se puede reactivar. No se borra: no hay FK entre
schemas y `inventario.recepcion` guarda `bodega_id`.

## D11. Banco

`nombre`, `codigo` (hasta 20, en mayúsculas, único) y `activo`. Lo crea, edita
y desactiva `super_admin`. El alta no siembra parámetros (los valores por
defecto son de SBA-20). Después del alta, `super_admin` invita al primer
`admin_banco`.

## D12. Red ABACO

Una migración inserta la fila con id fijo
`00000000-0000-4000-8000-00000000abac` y nombre `ABACO`. No hay alta ni
edición de redes. El banco sintético del seed cuelga de esa red.

## D13. Un usuario, varios bancos

Sí: varias filas en `usuario_rol`.

`GET /api/v1/yo/asignaciones` responde:

```ts
{
  rol: Rol;
  bancoId: string | null;
  bancoNombre: string | null;
  institucionId: string | null;
}
[];
```

La PWA:

- Con una asignación, la usa.
- Con varias, muestra un selector.
- Recuerda el último `bancoId` en `localStorage`. Solo el id; nunca tokens ni
  datos personales.
- Al cambiar de banco limpia la caché de React Query.

## D14. Tablas globales (SBA-61)

- `red` y `rol`: catálogos sin datos personales. `GRANT SELECT` a `sigba_app`,
  sin RLS. Queda escrito en la migración y en ADR-07.
- `usuario`: RLS. `sigba_app` ve una fila si es la propia (`app.usuario_id`) o
  si esa persona tiene una asignación activa en `app.banco_id`.
- `banco`: RLS con FORCE. Cualquiera lo lee, porque el guard cruza cada
  asignación con su banco. Solo se escribe con `app.banco_id` igual al banco
  escrito y `app.usuario_id` con la asignación activa de `super_admin` (D7). Lo
  comprueba `plataforma.actua_como_super_admin()`. El dueño de las tablas
  escribe por su propia política, para migraciones y semilla.
- `core.verificar_politicas_rls()` revisa también una lista explícita de tablas
  globales y falla si una no tiene control.

## D15. Quitar acceso

`admin_banco` desactiva la asignación (`usuario_rol.activo = false`) en su
banco. No se toca Auth0. Sin asignación activa, la persona recibe 403.

## D16. Auditoría y eventos

Se auditan crear, editar, desactivar y reactivar banco y bodega. De la
invitación: crear, reenviar, revocar y aceptar. Y el cambio de asignación. El
detalle no lleva correo ni token.

No se emiten eventos de plataforma en esta versión. Si M1 necesita invalidar
caché al desactivar una bodega, se agrega `BodegaDesactivada` sobre el outbox
de SBA-30.

## D17. SBA-19 en tres PR

La regla de 400 líneas no aguanta un PR único. Las ramas cumplen el formato
`sba-<n>-<titulo>`:

1. `sba-19-bancos-y-bodegas`: red ABACO, bancos y bodegas, API y PWA.
2. `sba-19-sesion-y-asignaciones`: `@Autenticado()`, `GET /yo/asignaciones`,
   `SesionProvider` y selector de banco.
3. `sba-19-invitaciones`: puerto de correo, invitaciones, aceptación y
   pantallas. Sale de la rama 2 y de SBA-61.

## D18. Idempotencia de las escrituras administrativas

Las escrituras administrativas de plataforma (crear o editar banco y bodega,
invitaciones, quitar acceso) no llevan `comandoId`: se hacen en línea desde la
web y se protegen con una llave natural. Crear la misma bodega (mismo nombre
normalizado, misma dirección, mismo banco) devuelve la existente con 200. Con
otros datos, o si la existente está desactivada, da 409. El banco funciona
igual, con el código como llave. Lo que pase por la cola offline del celular sí
lleva `comandoId` (AGENTS.md).
