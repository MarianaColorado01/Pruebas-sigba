import { useQuery } from '@tanstack/react-query';
import { ErrorDeApi } from '@/shared/clienteHttp.ts';
import type { ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { usePedir } from '@/shared/sesion.ts';
import { buscarEnCatalogo, type CatalogoEnPantalla } from './useCatalogo.ts';

export interface ResultadoDeBusqueda {
  referencias: ReferenciaDelCatalogo[];
  desactualizado: boolean;
}

export function useBuscarReferencias(
  texto: string,
  bancoId: string | null,
  cache?: CatalogoEnPantalla,
) {
  const pedir = usePedir();
  const limpio = texto.trim();

  return useQuery({
    queryKey: ['inventario', 'buscar', bancoId, limpio],
    enabled: Boolean(bancoId && limpio),
    queryFn: async (): Promise<ResultadoDeBusqueda> => {
      try {
        const referencias = await pedir<ReferenciaDelCatalogo[]>(
          `/referencias?texto=${encodeURIComponent(limpio)}`,
        );
        return { referencias, desactualizado: false };
      } catch (error) {
        if (error instanceof ErrorDeApi || !cache) throw error;
        return {
          referencias: buscarEnCatalogo(cache.catalogo, limpio),
          desactualizado: true,
        };
      }
    },
  });
}
