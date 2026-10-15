import { createBrowserRouter } from 'react-router';
import { CatalogoPage } from '../features/inventario/CatalogoPage.tsx';
import { StockPage } from '../features/inventario/StockPage.tsx';
import { PantallaDeAuditoria } from '../features/plataforma/auditoria/PantallaDeAuditoria.tsx';
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
  {
    path: '/catalogo',
    element: <CatalogoPage />,
  },
  {
    path: '/stock',
    element: <StockPage />,
  },
  // Plataforma · auditoría (SBA-51)
  {
    path: '/plataforma/auditoria',
    element: <PantallaDeAuditoria />,
  },
]);
