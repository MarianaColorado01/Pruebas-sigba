# Custodia de llaves

Pendiente de SBA-31. Esta página fija las reglas; SBA-31 completa los nombres, el lugar y
la rotación.

## Qué se va a guardar

- **Llave de cifrado del documento** de los beneficiarios (ADR-15).
- **Llave HMAC por banco**, para buscar un documento sin descifrarlo. Una por banco: la
  huella de un banco no sirve para cruzar con otro.
- **Llave privada de los respaldos**, si se adopta el volcado cifrado de
  [respaldos.md](respaldos.md).

## Reglas

- Las llaves viven fuera de la base y fuera de Git. La API las recibe como secretos de
  Fly.io.
- Nunca aparecen en logs, trazas de Sentry, cargas de evento, mensajes de error ni en
  documentos de este repositorio.
- Un respaldo de la base no sirve sin la llave de cifrado. Perder la llave es perder los
  documentos; por eso la llave tiene su propio respaldo, separado del de la base.
- Solo datos sintéticos hasta que SBA-31 pruebe cifrado, HMAC y recuperación de llaves
  (Alcance M2).

## Pendiente (SBA-31)

- Custodio de cada llave y su suplente.
- Dónde se guardan y dónde se guarda su respaldo.
- Rotación: cada cuánto, y cómo se recifran documentos y se recalculan huellas.
- Procedimiento si una llave se filtra.
