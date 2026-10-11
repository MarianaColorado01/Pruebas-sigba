# Cuentas de operación

> **Provisional:** cuentas personales de Mariana Colorado hasta que se defina el correo
> institucional.

Verificado en los paneles el AAAA-MM-DD (pendiente: falta revisar cada panel y poner la
fecha).

Registro de las cuentas de infraestructura de SIGBA para SBA-10. No guarda contraseñas,
tokens, llaves ni códigos de respaldo: los secretos viven en cada servicio.

| Servicio   | Uso                                                                                | Titular                                                   | Plan                  | Acceso                                                              | Recuperación                                                                                         |
| ---------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Neon       | PostgreSQL, con ramas por PR. Proyecto `sigba-db` en AWS `us-east-1`.              | GitHub `MarianaColorado01`                                | Gratuito              | Mariana Colorado (administradora), Camilo Agudelo, Juan Ordoñez     | Enlace de acceso al correo del GitHub titular. Si se pierde, un administrador pide la transferencia. |
| Auth0      | Identidad OIDC, sesiones, roles y emisión de JWT. Tenant de desarrollo, región US. | GitHub `MarianaColorado01`                                | Gratuito              | Mariana Colorado (propietaria). Segundo administrador pendiente.    | Inicio de sesión con GitHub o recuperación al correo asociado.                                       |
| Sentry     | Errores y trazas de la API y la PWA. Organización `sigba`.                         | GitHub `MarianaColorado01`                                | Developer (gratuito)  | Miembros de la organización `sigba`. Segundo propietario pendiente. | Inicio de sesión con GitHub. Otro propietario de la organización puede gestionar permisos.           |
| Cloudflare | Pages para la PWA y R2 para objetos.                                               | Correo de Mariana Colorado asociado a `MarianaColorado01` | Gratuito              | Mariana Colorado. Segundo administrador pendiente.                  | Enlace al correo titular. Los códigos 2FA van al almacén del equipo (pendiente nombrarlo).           |
| Fly.io     | API NestJS en la región `iad`.                                                     | GitHub `MarianaColorado01`, organización `Personal`       | Hobby (sin confirmar) | Solo Mariana Colorado: la organización personal no admite miembros. | Inicio de sesión con GitHub. Soporte de Fly.io al correo titular.                                    |

Fly.io tiene la cuenta creada, pero falta el método de pago de verificación para
desplegar el walking skeleton de SBA-7.

## Pendientes

- **Correo institucional.** Falta que el docente defina el correo titular y mover las
  cinco cuentas a él (ADR-03). Mientras tanto SBA-10 sigue abierto.
- **Fecha de verificación.** Revisar cada panel y poner la fecha arriba.
- **Plan de Fly.io.** Confirmarlo en el panel: el plan Hobby dejó de ofrecerse a
  organizaciones nuevas.
- **Segundo administrador.** Anotar en Auth0, Sentry, Cloudflare y Fly.io al menos una
  persona más con su rol. En Fly.io hay que crear antes la organización `sigba`.
- **Códigos 2FA.** Nombrar el almacén del equipo donde se guardan, sin su contenido.
- **Acceso a Neon.** Confirmar si «Juan Ordoñez» es Juan Ospina, capitán del Equipo 2.
