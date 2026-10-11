export function corsOrigins(
  value = process.env['CORS_ORIGINS'] ?? 'http://localhost:5173',
): string[] {
  const origins = [
    ...new Set(
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
  if (
    origins.length === 0 ||
    origins.some((origin) => {
      if (origin === '*') return true;
      try {
        const url = new URL(origin);
        return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin;
      } catch {
        return true;
      }
    })
  ) {
    throw new Error('CORS_ORIGINS debe contener orígenes HTTP(S) exactos, sin rutas ni comodines.');
  }

  return origins;
}
