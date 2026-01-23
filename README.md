# Liferay to Next.js SSG Extractor

This project implements a Static Site Generation (SSG) extractor to transform dynamic Liferay DXP pages into highly performant static Next.js pages. This approach offers significant benefits such as faster load times, improved SEO, enhanced security, and reduced server load for publicly accessible content by eliminating runtime dependencies on the Liferay instance for serving static assets.

## Architecture Overview

The solution leverages a combination of modern web technologies to achieve comprehensive content and asset extraction during the build process.

### Technologies Used:

*   **Liferay DXP:** The source Content Management System (CMS) providing dynamic pages, content, and theming.
*   **Next.js (SSG):** The React framework configured for Static Site Generation, utilizing the `pages` directory for routing.
*   **TypeScript:** Ensures type safety and improves code maintainability.
*   **Puppeteer:** A Node.js library controlling a headless Chrome/Chromium instance. It's used for fully rendering Liferay pages, including JavaScript execution, and for meticulous network interception to discover all loaded assets.
*   **Cheerio:** A server-side implementation of core jQuery functionalities, used for parsing and manipulating the HTML content scraped from Liferay.
*   **`node-fetch`:** Employed for making HTTP requests to the Liferay Headless API and for downloading discovered static assets.
*   **`serve`:** A utility for locally serving the generated static files for development and testing.

### Data Flow: Liferay Source to Static Pages

The extraction and generation process is divided into two primary phases: **Build Time (Static Generation)** and **Serve Time (Static Hosting)**.

#### Phase 1: Build Time (Static Generation)

This phase is executed via `npm run build` and encompasses the core logic for extracting, transforming, and packaging Liferay content into static Next.js artifacts.

1.  **Page Discovery (`getStaticPaths` in `pages/pages/[slug].tsx`):**
    *   `getStaticPaths` initiates an API call to the Liferay Headless API (`/v1.0/sites/{siteId}/site-pages`) using `getLiferayApiContent`.
    *   It retrieves a list of all site pages configured within Liferay.
    *   For each Liferay page, its `friendlyUrlPath` (e.g., `/testing-ssg`, `/another-page`) is extracted.
    *   These paths inform Next.js which dynamic routes (`[slug].tsx`) require static HTML generation.

2.  **Content & Asset Extraction (`getStaticProps` in `pages/pages/[slug].tsx`):**
    *   For every page identified by `getStaticPaths`, Next.js executes `getStaticProps`.
    *   `getStaticProps` first fetches the page's metadata using `getLiferayApiContent`.
    *   It constructs the **public-facing URL of the Liferay page** (e.g., `http://localhost:8080/web/guest/testing-ssg`).
    *   The crucial `getLiferayScrapedContent(publicLiferayPageUrl)` function is invoked:
        *   **Puppeteer Rendering (`getLiferayFullPageHtml`):** A headless Chromium instance is launched. Puppeteer navigates to the Liferay page's public URL, allowing Liferay's JavaScript to execute and fully render the page.
        *   **Network Interception:** During page load, Puppeteer intercepts all network requests. Requests for CSS (`stylesheet`) and JavaScript (`script`) resources originating from `LIFERAY_HOST` are captured, and their URLs are collected (`discoveredCssUrls`, `discoveredJsUrls`).
        *   **Full HTML Retrieval:** After the page is fully rendered, Puppeteer extracts the complete HTML content, including the final DOM structure, `<html>` and `<body>` tags with their attributes, and the `<head>` contents.
        *   **HTML & Asset Processing (`rewriteAndDownloadAssets`):**
            *   The `fullHtml` is parsed with Cheerio.
            *   **Image Handling:** All `<img>` and `<source>` tags are processed. If their `src`/`srcset` attributes point to Liferay assets, these images are **downloaded locally** to `public/assets/images/`, and their URLs in the HTML are rewritten to reference these local static files.
            *   **Inline CSS:** `<style>` tags embedded directly in the HTML are extracted. Their CSS content is analyzed for internal `url()` references (which are also rewritten to local assets), and the processed CSS is added to `extractedStyles`. The original `<style>` tags are removed from the HTML.
            *   **External CSS & JS (from network):** All previously captured `discoveredCssUrls` and `discoveredJsUrls` are processed. Each CSS file is **downloaded locally** to `public/assets/styles/`, its content is processed for internal `url()` references, and its local path is added to `extractedLinkStyles`. Similarly, all discovered JavaScript files are **downloaded locally** to `public/assets/scripts/`, and their local paths are added to `extractedScriptPaths`. Existing `<link rel="stylesheet">` and `<script src>` tags in the scraped HTML are removed to prevent duplication.
            *   The cleaned and asset-rewritten HTML content is returned.
        *   `DOMPurify.sanitize(rawHtml)`: The final HTML content injected into the page is sanitized to mitigate XSS risks.
        *   **Return Props:** `getStaticProps` packages the `pageData` (title, URL, sanitized HTML), `extractedStyles`, `extractedLinkStyles`, and `extractedScriptPaths` into `props` for the page component.

3.  **Page Rendering (`LiferayPage` component in `pages/pages/[slug].tsx`):**
    *   The `LiferayPage` React component receives the processed `props`.
    *   It sets the page title in the `<Head>`.
    *   It dynamically generates `<link rel="stylesheet">` tags in the `<Head>` for each local CSS path in `extractedLinkStyles`.
    *   It embeds processed inline CSS within `<style>` tags in the `<Head>` using `dangerouslySetInnerHTML`.
    *   It dynamically generates `<script src>` tags (with `defer`) in the `<Head>` for each local JavaScript path in `extractedScriptPaths`.
    *   The main Liferay content (`pageData.renderedHtml`) is injected into the page's DOM using `dangerouslySetInnerHTML`.

4.  **Global HTML Structure (`pages/_document.tsx`):**
    *   A custom `_document.tsx` is defined to control the root `<html>` and `<body>` tags of the Next.js document.
    *   It applies critical **global `<html>` and `<body>` attributes** (e.g., `class="ltr yui3-js-enabled"`, `dir="ltr"`, `lang="en-US"`, various `body` classes and `id`) that are essential for the Liferay theme's CSS and JavaScript to function correctly. These attributes are considered consistent across the theme and are hardcoded in `_document.tsx`.

#### Phase 2: Serve Time (Static Hosting)

*   Upon successful completion of `npm run build`, Next.js outputs a self-contained `out/` directory. This directory contains all generated static HTML files, along with the locally bundled CSS, JavaScript, and image assets.
*   This `out/` directory can be deployed and served by any standard static file server (e.g., `serve out` for local testing, Nginx, Apache, Netlify, Vercel, AWS S3/CloudFront).
*   When a user requests a static page (e.g., `your-static-site.com/pages/testing-ssg`), the pre-generated HTML is delivered instantly. All referenced CSS, JS, and images point to the locally served static assets, eliminating any further runtime calls back to the original Liferay instance for these resources and ensuring optimal performance.
