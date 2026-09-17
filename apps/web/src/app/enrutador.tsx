import { createBrowserRouter } from 'react-router';
import { Inicio } from './Inicio.tsx';

/**
 * Rutas de la PWA. Cada feature registra las suyas aquí
 * (Arquitectura 5.3: `app/` reúne router, layout, providers y sync).
 */
export const enrutador = createBrowserRouter([
  {
    path: '/',
    element: <Inicio />,
  },
]);
