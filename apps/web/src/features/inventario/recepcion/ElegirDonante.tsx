import { useState } from 'react';
import { cn } from 'cn';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import {
  type Donante,
  TIPOS_DE_DONANTE,
  type TipoDonante,
  useCrearDonante,
  useDonantes,
} from './datos.ts';
import { NOMBRE_DE_TIPO } from './nombres.ts';

interface Props {
  donante: Donante | null;
  onCambio: (donante: Donante | null) => void;
}

/**
 * Busca al donante por nombre o lo da de alta con nombre y tipo, sin salir de
 * la recepción (SBA-25). El alta va en línea: si ya hay uno con ese nombre y
 * tipo, la API devuelve ese.
 */
export function ElegirDonante({ donante, onCambio }: Props) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<TipoDonante | null>(null);
  const busqueda = useDonantes(texto);
  const crear = useCrearDonante();

  if (donante) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <span className="flex flex-col">
          <span className="text-lg font-medium">{donante.nombre}</span>
          <span className="text-sm text-muted-foreground">{NOMBRE_DE_TIPO[donante.tipo]}</span>
        </span>
        <Button variant="outline" size="lg" onClick={() => onCambio(null)}>
          Cambiar
        </Button>
      </div>
    );
  }

  const nombre = texto.trim();
  const encontrados = busqueda.data ?? [];

  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Buscar donante"
        placeholder="Escribe el nombre del donante"
        className="h-12 text-base"
        value={texto}
        onChange={(evento) => {
          setTexto(evento.target.value);
          crear.reset();
        }}
      />

      {busqueda.isError && <p role="alert">No se pudo buscar. Revisa la conexión.</p>}

      {encontrados.map((encontrado) => (
        <Button
          key={encontrado.id}
          variant="outline"
          className="h-auto min-h-12 justify-start py-3 text-left text-base whitespace-normal"
          onClick={() => onCambio(encontrado)}
        >
          {encontrado.nombre} · {NOMBRE_DE_TIPO[encontrado.tipo]}
        </Button>
      ))}

      {nombre && busqueda.isSuccess && (
        <fieldset className="flex flex-col gap-2 rounded-md border p-3">
          <legend className="px-1 font-medium">
            {encontrados.length ? '¿No está? Crea' : 'No existe. Crea'} «{nombre}» como
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_DE_DONANTE.map((opcion) => (
              <Button
                key={opcion}
                variant="outline"
                size="lg"
                aria-pressed={tipo === opcion}
                className={cn(tipo === opcion && 'border-primary bg-primary/10')}
                onClick={() => setTipo(opcion)}
              >
                {NOMBRE_DE_TIPO[opcion]}
              </Button>
            ))}
          </div>
          <Button
            size="lg"
            disabled={!tipo || crear.isPending}
            onClick={() => {
              if (tipo) crear.mutate({ nombre, tipo }, { onSuccess: onCambio });
            }}
          >
            {crear.isPending ? 'Creando…' : 'Crear donante'}
          </Button>
          {crear.isError && (
            <p role="alert">
              No se pudo crear el donante. Revisa la conexión e inténtalo de nuevo.
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
