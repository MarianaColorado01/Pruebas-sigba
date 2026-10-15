import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogoDb, type CatalogoGuardado } from '@/offline/catalogoDb.ts';
import type { Catalogo, ReferenciaDelCatalogo } from '@/shared/catalogo.ts';
import { ErrorDeApi, type RespuestaConEtag } from '@/shared/clienteHttp.ts';
import { useAsignacion, usePedirConEtag } from '@/shared/sesion.ts';

export interface CatalogoEnPantalla {
  catalogo: Catalogo;
  desactualizado: boolean;
}

export const CATALOGO_QUERY_KEY = ['inventario', 'catalogo'] as const;

export function useCatalogo() {
  const bancoId = useAsignacion()?.bancoId ?? null;
  const pedir = usePedirConEtag();
  const cliente = useQueryClient();
  const [cacheInicial, setCacheInicial] = useState<
    { bancoId: string; data: CatalogoEnPantalla } | undefined
  >();

  useEffect(() => {
    let vigente = true;
    if (bancoId) {
      void catalogoDb.leer(bancoId).then(
        (guardado) => {
          if (!vigente) return;
          if (guardado) {
            const dato = { catalogo: guardado.catalogo, desactualizado: true };
            setCacheInicial({ bancoId, data: dato });
            cliente.setQueryData([...CATALOGO_QUERY_KEY, bancoId], dato);
          }
        },
        () => undefined,
      );
    }
    return () => {
      vigente = false;
    };
  }, [bancoId, cliente]);

  const consulta = useQuery({
    queryKey: [...CATALOGO_QUERY_KEY, bancoId],
    enabled: Boolean(bancoId),
    staleTime: 0,
    queryFn: async (): Promise<CatalogoEnPantalla> => {
      if (!bancoId) throw new Error('La sesión no tiene un banco activo.');
      let guardado: CatalogoGuardado | undefined;
      try {
        guardado = await catalogoDb.leer(bancoId);
      } catch {
        // IndexedDB puede estar bloqueada; la lectura en red sigue disponible.
      }
      let respuesta: RespuestaConEtag<Catalogo>;
      try {
        respuesta = await pedir<Catalogo>('/catalogo', {
          headers: guardado ? { 'If-None-Match': guardado.etag } : undefined,
        });
      } catch (error) {
        if (error instanceof ErrorDeApi || !guardado) throw error;
        return { catalogo: guardado.catalogo, desactualizado: true };
      }
      if (respuesta.estado === 304) {
        if (!guardado) throw new Error('La API devolvió 304 sin una copia local.');
        return { catalogo: guardado.catalogo, desactualizado: false };
      }
      const etag = respuesta.etag ?? respuesta.datos.version;
      if (etag !== guardado?.etag) {
        try {
          await catalogoDb.guardar({ bancoId, etag, catalogo: respuesta.datos });
        } catch {
          // Una falla local no invalida la respuesta que ya entregó la API.
        }
      }
      return { catalogo: respuesta.datos, desactualizado: false };
    },
  });

  const datoLocal = cacheInicial?.bancoId === bancoId ? cacheInicial.data : undefined;
  return { ...consulta, data: consulta.data ?? datoLocal };
}

export function buscarEnCatalogo(catalogo: Catalogo, texto: string): ReferenciaDelCatalogo[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  return catalogo.categorias.flatMap((categoria) =>
    categoria.productos.flatMap((producto) =>
      producto.referencias
        .filter((referencia) =>
          palabras.every(
            (palabra) =>
              normalizar(referencia.presentacion).includes(palabra) ||
              normalizar(producto.nombre).includes(palabra) ||
              normalizar(categoria.codigo ?? '') === palabra,
          ),
        )
        .map((referencia) => ({
          ...referencia,
          activa: true,
          producto: { id: producto.id, nombre: producto.nombre },
          categoria: {
            id: categoria.id,
            codigo: categoria.codigo,
            nombre: categoria.nombre,
            linea: categoria.linea,
          },
        })),
    ),
  );
}

function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}
