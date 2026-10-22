import { createBrowserRouter, type RouteObject } from 'react-router';
import { PaginaInvitacion } from '@/features/plataforma/PaginaInvitacion.tsx';
import { PantallaUsuarios } from '@/features/plataforma/PantallaUsuarios.tsx';
import { PantallaInstituciones } from '../features/beneficiarios/PantallaInstituciones.tsx';
import { BajasPage } from '../features/inventario/bajas/BajasPage.tsx';
import { CatalogoPage } from '../features/inventario/CatalogoPage.tsx';
import { SalidaPage } from '../features/inventario/SalidaPage.tsx';
import { SincronizacionPage } from '../features/inventario/SincronizacionPage.tsx';
import { RecepcionPage } from '../features/inventario/recepcion/RecepcionPage.tsx';
import { PreciosPage } from '../features/inventario/precios/PreciosPage.tsx';
import { StockPage } from '../features/inventario/StockPage.tsx';
import { PantallaBancos } from '../features/plataforma/PantallaBancos.tsx';
import { PantallaBodegas } from '../features/plataforma/PantallaBodegas.tsx';
import { PantallaDeAuditoria } from '../features/plataforma/auditoria/PantallaDeAuditoria.tsx';
import { ColaProvider } from './ColaProvider.tsx';
import { Inicio } from './Inicio.tsx';
import { SesionProvider } from './SesionProvider.tsx';
import { Shell } from './Shell.tsx';

/**
 * Rutas de la PWA. Cada feature registra las suyas aquí
 * (Arquitectura 5.3: `app/` reúne router, layout, providers y sync).
 *
 * Las hijas de la ruta raíz exigen banco elegido. Una ruta que deba abrirse
 * sin asignación, como aceptar una invitación, va como hermana de esa raíz.
 */
export const rutas: RouteObject[] = [
  {
    element: (
      <SesionProvider>
        <ColaProvider>
          <Shell />
        </ColaProvider>
      </SesionProvider>
    ),
    children: [
      { index: true, element: <Inicio /> },
      { path: 'catalogo', element: <CatalogoPage /> },
      { path: 'stock', element: <StockPage /> },
      { path: 'sincronizacion', element: <SincronizacionPage /> },
      { path: 'recepcion', element: <RecepcionPage /> },
      { path: 'bajas', element: <BajasPage /> },
      { path: 'precios', element: <PreciosPage /> },
      { path: 'salidas/nueva', element: <SalidaPage /> },
      { path: 'plataforma/bodegas', element: <PantallaBodegas /> },
      { path: 'plataforma/usuarios', element: <PantallaUsuarios /> },
      { path: 'plataforma/bancos', element: <PantallaBancos /> },
      // Plataforma · auditoría (SBA-51)
      { path: 'plataforma/auditoria', element: <PantallaDeAuditoria /> },
      // Beneficiarios · directorio de instituciones (SBA-86)
      { path: 'beneficiarios/instituciones', element: <PantallaInstituciones /> },
    ],
  },
  // Sin sesión también: `AccesoAuth0` la deja pasar (D2).
  { path: '/invitacion/:token?', element: <PaginaInvitacion /> },
];

export const enrutador = createBrowserRouter(rutas);
