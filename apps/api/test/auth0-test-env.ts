process.env['AUTH0_ISSUER_URL'] ??= 'https://sigba-synthetic.us.auth0.com/';
process.env['AUTH0_AUDIENCE'] ??= 'https://api.sigba.synthetic';
// PlataformaModule valida el origen de la PWA al arrancar (SBA-19, D4).
process.env['WEB_URL'] ??= 'https://pwa.sigba.synthetic';
