# Liferay SSG Extractor with Next.js (PoC)

## 1. Objective

The main objective of this project is to transform a dynamic website managed in Liferay DXP into a high-performance static website. This allows leveraging the benefits of a static site (loading speed, security, scalability, low hosting costs) without sacrificing Liferay's powerful content management and page-building capabilities.

## 2. Adopted Approach: "Scrape & Bake"

To achieve the objective, a **"Scrape & Bake"** approach has been adopted.

Unlike a traditional SSG (Static Site Generation) which relies on consuming data APIs (JSON) to then rebuild views with React components, this solution opts for a method more faithful to the original:

1.  **Scrape**: A programmable browser (Puppeteer) is used to visit each page of the Liferay site as if it were a user. It waits for the page to fully render in the browser, including all client-side JavaScript logic.
2.  **Bake**: Once the final HTML is obtained, it is "baked" into a static page. This process involves parsing the captured HTML, downloading all its assets (CSS, JS, images, fonts), rewriting the paths to be local, and packaging everything into a production-ready file structure.

This approach was chosen because it ensures the **highest visual and functional fidelity** with the original Liferay site, capturing the output of complex widgets and applications that would be difficult or impossible to replicate using only data APIs.

## 3. Architecture Description

The solution is composed of the following key elements:

*   **Liferay DXP**: The source of truth for content management. It hosts the **Statify UI**.
    *   **Statify UI (Client Extension)**: A custom element integrated into the Liferay Admin interface that allows users to select specific pages for extraction.
*   **SSG Webhook Service (`/liferay/ssg-webhook`)**: A Node.js/Express service that acts as an orchestrator.
    *   Receives extraction requests from the Statify UI.
    *   Manages the build queue and coordinates the Next.js execution.
    *   **Cumulative Build Logic**: Implements a "Backup & Merge" strategy to allow partial exports without losing previously generated content.
*   **Next.js Extractor Engine (`/extractor/liferay-nextjs-ssg`)**: The core generation engine.
    *   **Puppeteer**: Headless browser that captures the fully rendered state of Liferay pages.
    *   **Cheerio**: Parses HTML to extract, download, and rewrite assets (images, CSS, JS, fonts).
    *   **Next.js SSG**: Uses `getStaticPaths` (fed by the webhook) and `getStaticProps` to generate static HTML files.
*   **Static Site (`/out` directory)**: The final cumulative output containing pure HTML, CSS, and JS files ready for deployment.

## 4. Key Implementation Features

### Cumulative & Partial Exports
The system supports exporting the entire site or just a selection of pages. When a partial export is triggered:
1.  The existing `out` folder is backed up.
2.  Next.js generates only the requested pages into a new `out` folder.
3.  The webhook merges the previous content from the backup into the new folder without overwriting the new files.
4.  This ensures the static site grows incrementally and stays up-to-date with minimal build time.

### Asset Localization
All external dependencies (images, stylesheets, scripts, fonts) are automatically downloaded to the `public/assets` directory within the Next.js project and their paths are rewritten in the HTML and CSS to ensure the static site is completely self-contained.

### SVG Inlining
To handle complex icon systems like Liferay's Lexicon/Clay, the extractor identifies `<use>` tags referencing external SVG sprites, downloads the sprite, extracts the specific symbol, and inlines it directly into the HTML to ensure icons render correctly in the static version.

## 5. Setup & Workflow

1.  **Start the Webhook Service**:
    ```bash
    cd liferay/ssg-webhook
    npm install
    npm start
    ```
2.  **Access Liferay**: Log in to your Liferay instance where the **Statify Client Extension** is deployed.
3.  **Select & Statify**: Use the Statify interface to pick the pages you want to export and click "Statify Selected Pages".
4.  **Monitor**: Follow the logs in the webhook service to see the progress of the Puppeteer scraping and Next.js building.
5.  **Result**: The final files will be available in `extractor/liferay-nextjs-ssg/out`.
