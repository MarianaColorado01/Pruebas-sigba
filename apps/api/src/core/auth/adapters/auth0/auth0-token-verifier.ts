import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Auth0Config } from '../../auth0-config.js';
import type { IdentidadDeAutenticacion } from '../../resolutor-de-identidad.js';
import type { TokenVerifier } from '../../token-verifier.js';

export class Auth0TokenVerifier implements TokenVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: Auth0Config) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(token: string): Promise<IdentidadDeAutenticacion> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ['RS256'],
      // jose solo revisa `exp` si viene; sin esta opción, un token sin
      // vencimiento valdría para siempre.
      requiredClaims: ['exp'],
    });

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('Invalid access token');
    }

    // Con la opción `issuer`, jose ya rechazó cualquier `iss` distinto.
    const identidad: IdentidadDeAutenticacion = {
      auth0Sub: payload.sub,
      emisor: this.config.issuer,
    };

    // Auth0 no pone el correo en el access token por sí solo. Una Action lo
    // agrega bajo la audiencia como espacio de nombres, y solo esas claves se
    // leen. Sin la Action no hay correo, y aceptar una invitación da 403.
    const espacio = this.config.audience.replace(/\/+$/, '');
    const email = payload[`${espacio}/email`];
    if (typeof email === 'string' && email.trim()) identidad.email = email;
    if (payload[`${espacio}/email_verified`] === true) identidad.emailVerificado = true;

    return identidad;
  }
}
