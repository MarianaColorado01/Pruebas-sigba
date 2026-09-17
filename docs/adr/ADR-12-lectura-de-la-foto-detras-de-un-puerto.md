# ADR-12 · Lectura de la foto del cuaderno detrás de un puerto, con verificación humana

- **Estado:** aceptado
- **Fecha:** 10 de septiembre de 2026
- **Fuente:** Documento de Arquitectura v1.2, anexo A

## Contexto

El cliente usa fotos de un cuaderno manuscrito. El OCR puro entrega texto que
luego necesita reglas de interpretación; un modelo multimodal también puede
omitir o inventar filas.

## Decisión

Mantener `ExtractorRecepcion` con adaptadores y un resultado estructurado que
**solo crea borrador**. La coordinación corrige y confirma.

La Iteración 0 compara tres proveedores con un conjunto autorizado y resultados
esperados; mide errores de referencia, cantidad y unidad, costo y tiempo. Las
fotos reales requieren control de datos antes de enviarlas.

## Consecuencias

La función conserva prioridad _Should_ y depende de red para extracción. La
captura manual sigue disponible.

El nivel de confianza no prueba exactitud: el equipo debe indicar cómo lo
calcula o lo recibe.

Descartar la escritura automática evita convertir errores del modelo en
inventario.
