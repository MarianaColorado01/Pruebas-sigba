import { IsOptional, IsUUID } from 'class-validator';

/** Los filtros de `GET /stock` (SBA-36, ADR-04). Todos opcionales. */
export class ConsultarStockDto {
  @IsOptional()
  @IsUUID()
  bodegaId?: string;

  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsOptional()
  @IsUUID()
  referenciaId?: string;
}
