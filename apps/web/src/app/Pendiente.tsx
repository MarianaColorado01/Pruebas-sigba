/**
 * Ocupa la ruta de una pantalla que hace otra rama, para que la navegación ya
 * lleve a algún lado. Se borra cuando llega la pantalla de verdad.
 */
export function Pendiente({ titulo }: { titulo: string }) {
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-2 px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <p className="text-muted-foreground">Esta pantalla todavía no está lista.</p>
    </section>
  );
}
