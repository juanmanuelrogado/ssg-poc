# Liferay SSG Extractor con Next.js

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

*   **Liferay DXP**: Actúa como la fuente de la verdad y el entorno de gestión de contenidos. Las páginas, el contenido, los widgets y los layouts se gestionan y renderizan aquí.
*   **Next.js Application (`/extractor/liferay-nextjs-ssg`)**: Es el motor de la extracción y generación.
    *   **Puppeteer**: Navegador headless (sin interfaz gráfica) que carga cada página pública de Liferay.
    *   **Cheerio**: Librería que analiza el HTML capturado por Puppeteer para extraer, descargar y reescribir todos los assets y enlaces.
    *   **Mecanismo SSG de Next.js**:
        *   `getStaticPaths`: Se ejecuta en tiempo de construcción para obtener la lista de todas las páginas que deben ser generadas.
        *   `getStaticProps`: Orquesta todo el proceso de "Scrape & Bake" para cada página individual.
*   **Sitio Estático (directorio `/out`)**: El resultado final del proceso `next build`. Contiene archivos HTML, CSS, y JS puros que pueden ser desplegados en cualquier servidor web estático o CDN.

## 4. Diagrama de Arquitectura

```mermaid
graph TD;
    subgraph "Liferay DXP"
        A[Contenidos, Layouts y Widgets]
    end

    subgraph "Fase de Build (Servidor CI/CD)"
        B(Aplicación Next.js SSG)
        B --"1. Llama a getStaticPaths para obtener lista de URLs"--> A
        B --"2. Para cada URL, inicia Puppeteer"--> C{Puppeteer (Navegador Headless)}
        C --"3. Carga la página de Liferay"--> A
        A --"4. Devuelve HTML renderizado y assets"--> C
        C --"5. Entrega HTML a Next.js"--> B
        B --"6. Cheerio analiza el HTML, descarga assets y reescribe rutas"--> B
        B --"7. `next build` genera los archivos finales"--> D[Sitio Estático (HTML, CSS, JS...)]
    end

    subgraph "Hosting/CDN"
        E[Servidor Web / CDN (ej. Vercel, AWS S3, Nginx)]
    end

    subgraph "Usuario Final"
        F[Navegador del Usuario]
    end

    D --> E
    E --> F
```

## 5. Flujo de Trabajo Completo

El proceso para generar y desplegar el sitio estático es el siguiente:

1.  **Configuración**: Crea un archivo `.env.local` en el directorio `extractor/liferay-nextjs-ssg/` con las siguientes variables de entorno:
    ```
    # Endpoint de la API de Liferay para obtener la lista de páginas
    LIFERAY_API_ENDPOINT="http://localhost:8080/o/c"

    # Host de la instancia de Liferay (para que Puppeteer la visite)
    LIFERAY_HOST="http://localhost:8080"

    # Prefijo opcional de la ruta si Liferay no se sirve desde la raíz (ej. /web)
    LIFERAY_PATH_PREFIX="/web"

    # ID del sitio de Liferay a extraer
    LIFERAY_SITE_ID="12345"

    # Credenciales de un usuario con permisos para acceder a las APIs y páginas
    LIFERAY_API_EMAIL="test@liferay.com"
    LIFERAY_API_PASSWORD="password"
    ```

2.  **Instalación de Dependencias**: Navega al directorio del extractor y ejecuta:
    ```bash
    cd extractor/liferay-nextjs-ssg
    npm install
    ```

3.  **Generación del Sitio Estático**: Ejecuta el comando de build de Next.js. Este proceso puede tardar varios minutos dependiendo de la cantidad y complejidad de las páginas.
    ```bash
    npm run build
    ```
    Este comando orquestará todo el proceso de "Scrape & Bake". El resultado final se guardará en el directorio `out`.

4.  **Verificación Local (Opcional)**: Para probar el sitio estático generado antes de desplegarlo, puedes usar el comando `start`:
    ```bash
    npm run start
    ```
    Esto levantará un servidor local en `http://localhost:3000` sirviendo el contenido del directorio `out`.

5.  **Despliegue**: Copia el contenido del directorio `extractor/liferay-nextjs-ssg/out` a un servidor web estático o a un servicio de hosting/CDN de tu elección.
