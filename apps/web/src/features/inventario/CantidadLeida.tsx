import { interpretarCantidad } from '@/shared/cantidad.ts';

const NUMERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 });

/**
 * Lo que la pantalla entendió del campo de cantidad, justo debajo: el error si
 * no vale (un punto, más cifras de las que admite la API, cero), o la cantidad
 * ya leída para que quien teclea vea si «4200» es lo que quería. Con tres
 * decimales como máximo, el formato no redondea nada.
 */
export function CantidadLeida({ texto }: { texto: string }) {
  const { valor, error } = interpretarCantidad(texto);
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (valor === null) return null;
  return (
    <p className="text-sm text-muted-foreground">Se registrará: {NUMERO.format(Number(valor))}</p>
  );
}
