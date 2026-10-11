import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { AccesoAuth0, ProviderAuth0 } from './auth0.tsx';
import { enrutador } from './enrutador.tsx';

// La bodega tiene señal inestable: reintentar poco y no refrescar al enfocar
// evita consumir datos y batería en peticiones que van a fallar igual (ADR-10).
const clienteDeConsultas = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function App() {
  return (
    <ProviderAuth0>
      <QueryClientProvider client={clienteDeConsultas}>
        <AccesoAuth0>
          <RouterProvider router={enrutador} />
        </AccesoAuth0>
      </QueryClientProvider>
    </ProviderAuth0>
  );
}
