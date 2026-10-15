import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Banco,
  BancosRepositorio,
  type CambiosEnBanco,
  CodigoDeBancoRepetido,
} from './banco.js';
import { requerido } from './texto.js';

const LARGO_NOMBRE = 200;
const LARGO_CODIGO = 20;
const FORMA_DE_CODIGO = /^[A-Z0-9-]+$/;

export interface NuevoBanco {
  nombre: string;
  codigo: string;
}

export type EdicionDeBanco = Partial<NuevoBanco>;

/**
 * Bancos de la red, del lado de `super_admin` (SBA-19, D11).
 *
 * El alta no siembra parámetros (son de SBA-20) ni usuarios: después del alta,
 * `super_admin` invita al primer `admin_banco`. Un banco no se borra: se
 * desactiva, y sus usuarios dejan de poder entrar a él.
 *
 * El alta no lleva `comandoId`: se hace en línea desde la web y su llave
 * natural es el código. Reenviar el mismo banco devuelve el existente
 * (`repetido`); el mismo código con otros datos es un 409.
 */
@Injectable()
export class AdministracionDeBancosService {
  constructor(private readonly repositorio: BancosRepositorio) {}

  async crear(nuevo: NuevoBanco): Promise<{ banco: Banco; repetido: boolean }> {
    const datos = {
      nombre: requerido(nuevo.nombre, LARGO_NOMBRE, 'El nombre del banco'),
      codigo: codigoValido(nuevo.codigo),
    };
    try {
      return { banco: await this.repositorio.crear(datos), repetido: false };
    } catch (error) {
      const existente = error instanceof CodigoDeBancoRepetido ? error.existente : null;
      if (existente?.activo && existente.nombre === datos.nombre) {
        return { banco: existente, repetido: true };
      }
      conflicto(error);
    }
  }

  async listar(): Promise<Banco[]> {
    return this.repositorio.listar();
  }

  async editar(id: string, edicion: EdicionDeBanco): Promise<Banco> {
    const cambios: CambiosEnBanco = {};
    if (edicion.nombre !== undefined) {
      cambios.nombre = requerido(edicion.nombre, LARGO_NOMBRE, 'El nombre del banco');
    }
    if (edicion.codigo !== undefined) cambios.codigo = codigoValido(edicion.codigo);
    return this.actualizar(id, cambios);
  }

  async desactivar(id: string): Promise<Banco> {
    return this.actualizar(id, { activo: false });
  }

  async reactivar(id: string): Promise<Banco> {
    return this.actualizar(id, { activo: true });
  }

  private async actualizar(id: string, cambios: CambiosEnBanco): Promise<Banco> {
    const banco = await this.repositorio.actualizar(id, cambios).catch(conflicto);
    if (!banco) throw new NotFoundException('No existe ese banco.');
    return banco;
  }
}

function conflicto(error: unknown): never {
  if (error instanceof CodigoDeBancoRepetido)
    throw new ConflictException('Ya existe un banco con ese código.');
  throw error;
}

/** En mayúsculas, con letras sin tilde, dígitos y guiones (D11). */
function codigoValido(codigo: string): string {
  const limpio = requerido(codigo, LARGO_CODIGO, 'El código del banco').toUpperCase();
  if (!FORMA_DE_CODIGO.test(limpio)) {
    throw new BadRequestException('El código solo admite letras sin tilde, dígitos y guiones.');
  }
  return limpio;
}
