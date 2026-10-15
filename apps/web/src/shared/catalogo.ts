export interface ReferenciaDelCatalogo {
  id: string;
  presentacion: string;
  equivalenciaKg: string;
  creadaDesdeCelular: boolean;
  activa: boolean;
  producto: { id: string; nombre: string };
  categoria: { id: string; codigo: string | null; nombre: string; linea: string | null };
}

export interface Catalogo {
  version: string;
  categorias: {
    id: string;
    codigo: string | null;
    nombre: string;
    linea: string | null;
    descripcion: string | null;
    productos: {
      id: string;
      nombre: string;
      referencias: {
        id: string;
        presentacion: string;
        equivalenciaKg: string;
        creadaDesdeCelular: boolean;
      }[];
    }[];
  }[];
}
