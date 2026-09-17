# SIGBA · Sistema Integrado de Gestión para Bancos de Alimentos

Monolito modular en NestJS y PWA en React para el Banco de Alimentos de Pereira
(Fundación Cáritas · Diócesis de Pereira). Piloto de doce semanas, del 3 de
septiembre al 25 de noviembre de 2026.

## Requisitos

| Herramienta | Versión                |
| ----------- | ---------------------- |
| Node.js     | 24 (ver `.nvmrc`)      |
| pnpm        | 11.18.0 (vía Corepack) |
| Docker      | para el Postgres local |

```bash
corepack enable
pnpm install
docker compose up -d
pnpm dev
```

## Estructura

```
apps/api      NestJS · core y los módulos plataforma, inventario, beneficiarios, analitica
apps/web      React + Vite · PWA local-first
packages/     shared-types, ui, config
docs/         arquitectura, alcances, cronograma y ADR
```

La estructura sigue la sección 5.3 del documento de arquitectura. Las reglas de
frontera entre módulos están en la 5.2 y las verifica el lint.

## Cómo trabajamos

Linear es la fuente de verdad: <https://linear.app/iuva/team/SBA>

El flujo de trabajo, el formato de rama y la definición de terminado están en
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

## Documentos

| Documento                  | Archivo                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| Arquitectura (arc42)       | [`docs/01_Arquitectura_SIGBA.pdf`](docs/01_Arquitectura_SIGBA.pdf)             |
| Alcance M1 · Inventario    | [`docs/02_Alcance_M1_Inventario.pdf`](docs/02_Alcance_M1_Inventario.pdf)       |
| Alcance M2 · Beneficiarios | [`docs/02_Alcance_M2_Beneficiarios.pdf`](docs/02_Alcance_M2_Beneficiarios.pdf) |
| Alcance M3 · Plataforma    | [`docs/02_Alcance_M3_Plataforma.pdf`](docs/02_Alcance_M3_Plataforma.pdf)       |
| Cronograma                 | [`docs/03_Cronograma_SIGBA.pdf`](docs/03_Cronograma_SIGBA.pdf)                 |
| Presupuesto                | [`docs/04_Presupuesto_SIGBA.pdf`](docs/04_Presupuesto_SIGBA.pdf)               |
| Registros de decisión      | [`docs/adr/`](docs/adr/)                                                       |

## Equipos

| Equipo   | Módulo                     |
| -------- | -------------------------- |
| Equipo 1 | `beneficiarios`            |
| Equipo 2 | `inventario`               |
| Equipo 3 | `plataforma` y `analitica` |

Capitanes: @MiloAgudelo (equipo 3), @MarianaColorado01 y @poethy.
Arquitectura e integración: Camilo Agudelo Jaramillo.

## Licencia

Sin licencia pública. El equipo conserva la autoría del código.
