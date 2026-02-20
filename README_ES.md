# Extractor SSG de Liferay con Next.js (PoC)

## 1. Objetivo

El objetivo principal de este proyecto es transformar un sitio web dinámico gestionado en Liferay DXP en un sitio web estático de alto rendimiento. Esto permite beneficiarse de las ventajas de un sitio estático (velocidad de carga, seguridad, escalabilidad, bajo coste de hosting) sin sacrificar la potente capacidad de gestión de contenidos y construcción de páginas de Liferay.

## 2. Aproximación Adoptada: "Scrape & Bake"

Para lograr el objetivo, se ha adoptado un enfoque de **"Scrape & Bake" (Extraer y Hornear)**.

A diferencia de un SSG (Static Site Generation) tradicional que se basa en consumir APIs de datos (JSON) para luego reconstruir las vistas con componentes de React, esta solución opta por un método más fiel al original:

1.  **Scrape (Extraer)**: Se utiliza un navegador programable (Puppeteer) para visitar cada página del sitio de Liferay como si fuera un usuario. Se espera a que la página se renderice por completo en el navegador, incluyendo toda la lógica ejecutada por JavaScript en el lado del cliente.
2.  **Bake (Hornear)**: Una vez que se tiene el HTML final, se "hornea" en una página estática. Este proceso implica analizar el HTML capturado, descargar todos sus assets (CSS, JS, imágenes, fuentes), reescribir las rutas para que sean locales y empaquetar todo en una estructura de archivos lista para producción.

Se eligió esta aproximación porque garantiza la **máxima fidelidad visual y funcional** con el sitio original de Liferay, capturando el resultado de complejos widgets y aplicaciones que serían difíciles o imposibles de replicar únicamente con APIs de datos.

## 3. Descripción de la Arquitectura

La solución se compone de los siguientes elementos clave:

*   **Liferay DXP**: La fuente de la verdad para la gestión de contenidos. Aloja la **Statify UI**.
    *   **Statify UI (Client Extension)**: Un elemento personalizado integrado en la interfaz de administración de Liferay que permite a los usuarios seleccionar páginas específicas para su extracción.
*   **Servicio Webhook SSG (`/liferay/ssg-webhook`)**: Un servicio Node.js/Express que actúa como orquestador.
    *   Recibe solicitudes de extracción de la Statify UI.
    *   Gestiona la cola de construcción y coordina la ejecución de Next.js.
    *   **Lógica de Construcción Acumulativa**: Implementa una estrategia de "Backup & Merge" para permitir exportaciones parciales sin perder el contenido generado anteriormente.
*   **Motor Extractor Next.js (`/extractor/liferay-nextjs-ssg`)**: El motor de generación central.
    *   **Puppeteer**: Navegador headless que captura el estado completamente renderizado de las páginas de Liferay.
    *   **Cheerio**: Analiza el HTML para extraer, descargar y reescribir assets (imágenes, CSS, JS, fuentes).
    *   **Next.js SSG**: Utiliza `getStaticPaths` (alimentado por el webhook) y `getStaticProps` para generar archivos HTML estáticos.
*   **Sitio Estático (directorio `/out`)**: El resultado final acumulativo que contiene archivos HTML, CSS y JS puros listos para el despliegue.

## 4. Características Clave de la Implementación

### Exportaciones Parciales y Acumulativas
El sistema permite exportar todo el sitio o solo una selección de páginas. Cuando se dispara una exportación parcial:
1.  Se realiza una copia de seguridad de la carpeta `out` existente.
2.  Next.js genera solo las páginas solicitadas en una nueva carpeta `out`.
3.  El webhook fusiona el contenido anterior de la copia de seguridad en la nueva carpeta sin sobrescribir los archivos nuevos.
4.  Esto garantiza que el sitio estático crezca de forma incremental y se mantenga actualizado con un tiempo de build mínimo.

### Localización de Assets
Todas las dependencias externas (imágenes, hojas de estilo, scripts, fuentes) se descargan automáticamente al directorio `public/assets` dentro del proyecto Next.js y sus rutas se reescriben en el HTML y CSS para garantizar que el sitio estático sea completamente autónomo.

### Inlining de SVG
Para manejar sistemas de iconos complejos como Lexicon/Clay de Liferay, el extractor identifica las etiquetas `<use>` que hacen referencia a sprites SVG externos, descarga el sprite, extrae el símbolo específico y lo inserta directamente en el HTML para garantizar que los iconos se rendericen correctamente en la versión estática.

## 5. Configuración y Flujo de Trabajo

1.  **Iniciar el Servicio Webhook**:
    ```bash
    cd liferay/ssg-webhook
    npm install
    npm start
    ```
2.  **Acceder a Liferay**: Inicia sesión en tu instancia de Liferay donde está desplegada la **Statify Client Extension**.
3.  **Seleccionar y Statificar**: Utiliza la interfaz de Statify para elegir las páginas que deseas exportar y haz clic en "Statify Selected Pages".
4.  **Monitorear**: Sigue los logs en el servicio webhook para ver el progreso de la extracción con Puppeteer y la construcción con Next.js.
5.  **Resultado**: Los archivos finales estarán disponibles en `extractor/liferay-nextjs-ssg/out`.
