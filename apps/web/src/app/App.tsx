import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
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
    <QueryClientProvider client={clienteDeConsultas}>
      <RouterProvider router={enrutador} />
    </QueryClientProvider>
  );
}
