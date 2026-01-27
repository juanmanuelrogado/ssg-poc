import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs/promises';
import puppeteer from 'puppeteer';

const LIFERAY_API_ENDPOINT = process.env.LIFERAY_API_ENDPOINT;
const LIFERAY_HOST = process.env.LIFERAY_HOST;
const LIFERAY_API_EMAIL = process.env.LIFERAY_API_EMAIL;
const LIFERAY_API_PASSWORD = process.env.LIFERAY_API_PASSWORD;

if (!LIFERAY_API_ENDPOINT) {
  throw new Error('LIFERAY_API_ENDPOINT is not defined in .env.local');
}
if (!LIFERAY_HOST) {
  throw new Error('LIFERAY_HOST is not defined in .env.local');
}

let authHeader: string | undefined;
if (LIFERAY_API_EMAIL && LIFERAY_API_PASSWORD) {
  const credentials = `${LIFERAY_API_EMAIL}:${LIFERAY_API_PASSWORD}`;
  authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
} else {
  console.warn('LIFERAY_API_EMAIL or LIFERAY_API_PASSWORD not defined. Proceeding without Basic Auth.');
}

export async function getLiferayApiContent(apiPath: string = ''): Promise<any> {
  const url = `${LIFERAY_API_ENDPOINT}${apiPath}`;
  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(url, {
      headers,
      next: { revalidate: 3600 }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Liferay JSON content from ${url}: ${response.status} - ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`Error fetching Liferay JSON content from ${url}:`, error);
    throw error;
  }
}

async function getLiferayFullPageHtml(pageUrl: string): Promise<{ html: string; discoveredCssUrls: string[]; discoveredJsUrls: string[] }> {
  let browser;
  const discoveredCssUrls: Set<string> = new Set();
  const discoveredJsUrls: Set<string> = new Set();

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();

    if (authHeader) {
      await page.setExtraHTTPHeaders({
        'Authorization': authHeader,
      });
    }

    await page.setRequestInterception(true);
    page.on('request', request => {
      const resourceType = request.resourceType();
      const url = request.url();

      if (resourceType === 'stylesheet' && url.startsWith(LIFERAY_HOST!)) { 
        discoveredCssUrls.add(url);
      } else if (resourceType === 'script' && url.startsWith(LIFERAY_HOST!)) {
        discoveredJsUrls.add(url);
      }
      request.continue();
    });
    
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });

    const fullHtml = await page.content();

    return { html: fullHtml, discoveredCssUrls: Array.from(discoveredCssUrls), discoveredJsUrls: Array.from(discoveredJsUrls) };
  } catch (error) {
    console.error(`Error scraping Liferay page from ${pageUrl}:`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function downloadAndRewriteAsset(originalAbsoluteUrl: string, assetType: string): Promise<string> {
  if (!originalAbsoluteUrl) {
    return '';
  }

  const hash = createHash('sha256').update(originalAbsoluteUrl).digest('hex'); // Use SHA256 hash
  const extension = assetType === 'styles' ? '.css' : assetType === 'scripts' ? '.js' : path.extname(new URL(originalAbsoluteUrl).pathname);
  const localFilename = `${hash}${extension}`; // Use the full hash

  const localDir = path.join(process.cwd(), 'public', 'assets', assetType);
  const localFilePath = path.join(localDir, localFilename);
  const publicPath = `/assets/${assetType}/${localFilename}`;

  await fs.mkdir(localDir, { recursive: true });

  try {
    try {
      await fs.access(localFilePath);
      return publicPath;
    } catch {
      // File does not exist, proceed with download
    }

    const response = await fetch(originalAbsoluteUrl, {
      headers: authHeader ? { 'Authorization': authHeader } : {},
    });

    if (!response.ok) {
      console.warn(`Failed to download asset from ${originalAbsoluteUrl}: ${response.status} - ${response.statusText}`);
      return originalAbsoluteUrl;
    }

    let content: Buffer | string;
    if (assetType === 'styles' || assetType === 'scripts') {
      content = await response.text();
    } else {
      content = Buffer.from(await response.arrayBuffer());
    }
    
    await fs.writeFile(localFilePath, content);
    return publicPath;
  } catch (downloadError) {
    console.warn(`Error downloading asset from ${originalAbsoluteUrl}:`, downloadError);
    return originalAbsoluteUrl;
  }
}

async function processAndRewriteCssUrls(cssContent: string, baseUrl: string): Promise<string> {
  const urlRegex = /url\(['"]?(.*?)['"]?\)/g;
  let processedCss = cssContent;
  const cssAssetPromises: Promise<void>[] = [];

  let match: RegExpExecArray | null;
  const currentCssContent = cssContent; 
  while ((match = urlRegex.exec(currentCssContent)) !== null) {
    const originalUrl = match[1];
    if (originalUrl && originalUrl.startsWith('/')) {
      const absoluteUrl = new URL(originalUrl, baseUrl).toString();
      const assetType = (originalUrl.match(/\.(png|jpg|jpeg|gif|svg|webp|eot|ttf|woff|woff2)$/i)) ? 'images' : 'fonts';

      cssAssetPromises.push(
        downloadAndRewriteAsset(absoluteUrl, assetType).then(newLocalUrl => {
          processedCss = processedCss.replace(match![0], `url('${newLocalUrl}')`);
        })
      );
    }
  }
  await Promise.all(cssAssetPromises);
  return processedCss;
}

export async function rewriteAndDownloadAssets(html: string, baseUrl: string, discoveredCssUrls: string[], discoveredJsUrls: string[], allFriendlyUrlPaths: Set<string>): Promise<{ html: string; extractedStyles: string[]; extractedLinkStyles: string[]; extractedScriptPaths: string[] }> {
  const $ = cheerio.load(html);

  const assetPromises: Promise<void>[] = [];
  const extractedStyleContents: string[] = [];
  const extractedLinkStylePaths: string[] = [];
  const extractedScriptPaths: string[] = [];

  // Rewrite img src and download
  $('img').each((_i, img) => {
    const src = $(img).attr('src');
    if (src && src.startsWith('/')) {
      const originalAbsoluteUrl = new URL(src, baseUrl).toString();
      assetPromises.push(
        downloadAndRewriteAsset(originalAbsoluteUrl, 'images').then(newSrc => {
          $(img).attr('src', newSrc);
        })
      );
    }
  });

  // Rewrite source srcset and download
  $('source').each((_i, source) => {
    const srcset = $(source).attr('srcset');
    if (srcset) {
      const rewrittenSrcsetPromises = srcset.split(',').map(async s => {
        const parts = s.trim().split(' ');
        const url = parts[0];
        if (url && url.startsWith('/')) {
          const originalAbsoluteUrl = new URL(url, baseUrl).toString();
          const newUrl = await downloadAndRewriteAsset(originalAbsoluteUrl, 'images');
          return newUrl + (parts[1] ? ` ${parts[1]}` : '');
        }
        return s;
      });
      assetPromises.push(Promise.all(rewrittenSrcsetPromises).then(rewrittenParts => {
        $(source).attr('srcset', rewrittenParts.join(', '));
      }));
    }
  });

  // Handle <svg><use href="..."> tags and download SVG sprites
  $('svg use').each((_i, use) => {
    const href = $(use).attr('href');
    if (href) {
      const parts = href.split('#');
      const baseUrl = parts[0]; // e.g., http://localhost:8080/o/classic-theme/images/clay/icons.svg
      const fragment = parts[1] ? `#${parts[1]}` : ''; // e.g., #user

      // Only process internal SVG sprites that have a base URL
      if (baseUrl && baseUrl.startsWith(LIFERAY_HOST!)) {
        const originalAbsoluteUrl = baseUrl;
        assetPromises.push(
          downloadAndRewriteAsset(originalAbsoluteUrl, 'images').then(newLocalPath => {
            $(use).attr('href', `${newLocalPath}${fragment}`);
          })
        );
      }
    }
  });

  // Handle <a href="...">
  $('a').each((_i, a) => {
    const href = $(a).attr('href');
    if (href) {
      let finalHref = href;
      let isInternalLink = false;
      let potentialPath: string | undefined;

      try {
        // Fully qualified URL, absolute path, or relative path
        const url = new URL(href, href.startsWith('/') ? baseUrl : undefined);

        if (url.hostname === new URL(baseUrl).hostname) {
          // This is a link to the Liferay instance, let's process it.
          potentialPath = url.pathname;
        }
        // If hostnames don't match, it's an external link, so we'll leave finalHref as is.
      } catch (e) {
        // Not a valid URL or path, e.g., an anchor #, leave it as is.
      }
      
      if (potentialPath) {
        // Case 1: Liferay's /web/guest/ path
        const liferayGuestPathMatch = potentialPath.match(/^\/web\/guest(\/.*)/);
        if (liferayGuestPathMatch) {
            const friendlyUrlPath = liferayGuestPathMatch[1];
            if (allFriendlyUrlPaths.has(friendlyUrlPath)) {
                finalHref = `/pages${friendlyUrlPath}`;
                isInternalLink = true;
            }
        } 
        // Case 2: Direct relative path that matches a friendlyUrlPath
        else if (allFriendlyUrlPaths.has(potentialPath)) {
            finalHref = `/pages${potentialPath}`;
            isInternalLink = true;
        }
      }

      // If it was a relative link pointing to Liferay that we did not statify, make it absolute.
      if (!isInternalLink && href.startsWith('/')) {
        finalHref = new URL(href, baseUrl).toString();
      }
      
      $(a).attr('href', finalHref);
    }
  });

  // Handle <style> tags (inline CSS) - process content for internal url() references and extract
  $('style').each((_i, styleTag) => {
    const cssContent = $(styleTag).html();
    if (cssContent) {
      assetPromises.push(
        processAndRewriteCssUrls(cssContent, baseUrl).then(newCssContent => {
          extractedStyleContents.push(newCssContent);
          $(styleTag).remove();
        })
      );
    }
  });

  // --- Use discoveredCssUrls for external stylesheets ---
  // Remove existing <link rel="stylesheet"> tags from the HTML as they will be linked via props
  $('link[rel="stylesheet"]').remove(); 
  
  // Download and process DISCOVERED CSS URLs
  const cssDownloadPromises = discoveredCssUrls.map(url =>
    downloadAndRewriteAsset(url, 'styles').then(async localPath => {
      extractedLinkStylePaths.push(localPath);
      // Process content of this downloaded CSS file for internal URLs
      const rawCssContent = await fs.readFile(path.join(process.cwd(), 'public', localPath), 'utf8');
      const processedCssContent = await processAndRewriteCssUrls(rawCssContent, baseUrl);
      await fs.writeFile(path.join(process.cwd(), 'public', localPath), processedCssContent);
    })
  );
  assetPromises.push(...cssDownloadPromises);

  // --- Use discoveredJsUrls for external scripts ---
  // Remove existing <script src> tags from the HTML as they will be re-rendered via props
  $('script[src]').remove();

  // Download DISCOVERED JS URLs
  const jsDownloadPromises = discoveredJsUrls.map(url =>
    downloadAndRewriteAsset(url, 'scripts').then(localPath => {
      extractedScriptPaths.push(localPath);
    })
  );
  assetPromises.push(...jsDownloadPromises);

  await Promise.all(assetPromises);

  return { html: $.html(), extractedStyles: extractedStyleContents, extractedLinkStyles: extractedLinkStylePaths, extractedScriptPaths };
}

export async function getLiferayScrapedContent(publicPageUrl: string, allFriendlyUrlPaths: Set<string>): Promise<{ html: string; extractedStyles: string[]; extractedLinkStyles: string[]; extractedScriptPaths: string[] }> {
  try {
    const { html: fullHtml, discoveredCssUrls, discoveredJsUrls } = await getLiferayFullPageHtml(publicPageUrl);
    console.log('--- Full HTML from Puppeteer (snippet) for', publicPageUrl, '---');
    console.log(fullHtml.substring(0, 2000) + '...');
    console.log('--- End Full HTML from Puppeteer ---');
    console.log('--- Discovered CSS URLs (via Network) ---');
    discoveredCssUrls.forEach(url => console.log(url));
    console.log('--- End Discovered CSS URLs ---');
    console.log('--- Discovered JS URLs (via Network) ---');
    discoveredJsUrls.forEach(url => console.log(url));
    console.log('--- End Discovered JS URLs ---');


    const { html: processedHtml, extractedStyles, extractedLinkStyles, extractedScriptPaths } = await rewriteAndDownloadAssets(fullHtml, LIFERAY_HOST!, discoveredCssUrls, discoveredJsUrls, allFriendlyUrlPaths); 
    
    const $ = cheerio.load(processedHtml);
    const bodyContent = $('body').html() || '';

    return { html: bodyContent, extractedStyles, extractedLinkStyles, extractedScriptPaths };
  } catch (error) {
    console.error(`Error getting Liferay page content from ${publicPageUrl}:`, error);
    throw error;
  }
}