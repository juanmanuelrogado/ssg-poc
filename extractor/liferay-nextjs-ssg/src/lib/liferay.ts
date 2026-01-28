import { createHash } from 'crypto';
import { Buffer } from 'buffer';
import * as cheerio from 'cheerio';
import * as path from 'path';
import * as fs from 'fs/promises';
import puppeteer from 'puppeteer';

// Helper function to escape special characters in a string for use in a RegExp
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// Store SVG sprite contents globally for inlining
const svgSpriteContents = new Map<string, string>();

const LIFERAY_API_ENDPOINT = process.env.LIFERAY_API_ENDPOINT;
const LIFERAY_HOST = process.env.LIFERAY_HOST;
const LIFERAY_API_EMAIL = process.env.LIFERAY_API_EMAIL;
const LIFERAY_API_PASSWORD = process.env.LIFERAY_API_PASSWORD;
const LIFERAY_PATH_PREFIX = process.env.LIFERAY_PATH_PREFIX || ''; // Default to empty string

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

export async function getLiferayApiContent(apiPath: string = '', pageSize?: number): Promise<any> {
  const urlObj = new URL(`${LIFERAY_API_ENDPOINT}${apiPath}`);
  if (pageSize !== undefined && apiPath.includes('/site-pages')) {
    urlObj.searchParams.set('pageSize', pageSize.toString());
  }
  const url = urlObj.toString();
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

    const jsonResponse = await response.json();
    console.log(`[getLiferayApiContent] Successfully fetched from ${url}. Response (first 500 chars):`, JSON.stringify(jsonResponse).substring(0, 500));
    return jsonResponse;
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
  console.log(`[downloadAndRewriteAsset] Starting for URL: ${originalAbsoluteUrl}, Type: ${assetType}`);
  if (!originalAbsoluteUrl) {
    console.warn(`[downloadAndRewriteAsset] originalAbsoluteUrl is empty, returning a placeholder ('#').`);
    return '#';
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
      console.log(`[downloadAndRewriteAsset] Failed to download, returning originalAbsoluteUrl: ${originalAbsoluteUrl}`);
      return originalAbsoluteUrl;
    }

    let content: Buffer | string;
    if (assetType === 'styles' || assetType === 'scripts' || originalAbsoluteUrl.endsWith('.svg')) { // MODIFIED: Check for .svg explicitly
      content = await response.text();
      if (originalAbsoluteUrl.endsWith('.svg')) {
          svgSpriteContents.set(originalAbsoluteUrl, content); // Store SVG content
      }
    } else {
      content = Buffer.from(await response.arrayBuffer());
    }
    
    await fs.writeFile(localFilePath, content);
    console.log(`Downloaded asset: ${originalAbsoluteUrl} to ${publicPath}`); // ADDED LOG
    console.log(`[downloadAndRewriteAsset] Successfully processed URL: ${originalAbsoluteUrl}, returning publicPath: ${publicPath}`);
    return publicPath;
  } catch (downloadError) {
    console.error(`[downloadAndRewriteAsset] Error during processing for URL: ${originalAbsoluteUrl}, Type: ${assetType}`, downloadError);
    return originalAbsoluteUrl;
  }
}

async function processAndRewriteCssUrls(cssContent: string, baseUrl: string): Promise<string> {
  console.log(`[processAndRewriteCssUrls] Starting for CSS content length: ${cssContent.length}, Base URL: ${baseUrl}`);

  // Handle @import rules by recursively inlining
  const importRegex = /@import\s+(?:url\((['"]?)(.*?)\1\)|(['"])(.*?)\3);?/g;
  let inlinedCss = cssContent;
  const importMatches = Array.from(inlinedCss.matchAll(importRegex));

  if (importMatches.length > 0) {
    const importReplacements = await Promise.all(
      importMatches.map(async (match) => {
        const importUrl = match[2] || match[4];
        if (importUrl) {
          try {
            const absoluteUrl = new URL(importUrl, baseUrl).toString();
            
            if (!absoluteUrl.startsWith(LIFERAY_HOST!)) {
                // External import, leave it as is.
                return { from: match[0], to: match[0] };
            }

            console.log(`[processAndRewriteCssUrls] Processing @import: ${importUrl} -> ${absoluteUrl}`);
            // Basic circular dependency check
            if (absoluteUrl === baseUrl) {
                return { from: match[0], to: '' };
            }
            const response = await fetch(absoluteUrl, { headers: authHeader ? { 'Authorization': authHeader } : {} });
            if (response.ok) {
              const importedText = await response.text();
              const processedImport = await processAndRewriteCssUrls(importedText, absoluteUrl);
              return { from: match[0], to: processedImport };
            }
            console.warn(`[processAndRewriteCssUrls] FAILED to fetch imported CSS from ${absoluteUrl}: ${response.status}`);
          } catch (e) {
            console.error(`[processAndRewriteCssUrls] FAILED to process @import for ${importUrl}:`, e);
          }
        }
        return { from: match[0], to: '' }; // Remove if fails or invalid
      })
    );

    for (const { from, to } of importReplacements) {
      inlinedCss = inlinedCss.replace(from, to);
    }
  }


  const urlRegex = /url\((?!['"]?data:)(['"]?)(.*?)\1\)/g;
  let processedCss = inlinedCss; // Use the version with inlined imports
  const cssAssetPromises: Promise<{ from: string, to: string }>[] = [];

  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(inlinedCss)) !== null) {
    try {
      const originalUrl = match[2];
      const matchFrom = match[0];
      if (originalUrl) {
        let absoluteUrl: string;
        try {
          absoluteUrl = new URL(originalUrl, baseUrl).toString();
        } catch (urlError) {
          continue; // Skip this URL if it's malformed
        }

        if (absoluteUrl.startsWith(LIFERAY_HOST!)) {
            const assetType = (originalUrl.match(/\.(png|jpg|jpeg|gif|svg|webp|eot|ttf|woff|woff2)$/i)) ? 'images' : 'fonts';
            cssAssetPromises.push(
              downloadAndRewriteAsset(absoluteUrl, assetType).then(newLocalUrl => {
                return { from: matchFrom, to: `url('${newLocalUrl}')` };
              })
            );
        }
      }
    } catch (e) {
      console.error(`[processAndRewriteCssUrls] Error processing match: ${match[0]}`, e);
      console.error(`[processAndRewriteCssUrls] Problematic CSS content: ${inlinedCss}`);
    }
  }
  const replacements = await Promise.all(cssAssetPromises);

  for(const replacement of replacements) {
    processedCss = processedCss.replaceAll(replacement.from, replacement.to);
  }

  console.log(`[processAndRewriteCssUrls] Finished, processed CSS length: ${processedCss.length}`);
  return processedCss;
}

 export async function rewriteAndDownloadAssets(html: string, baseUrl: string, discoveredCssUrls: string[], discoveredJsUrls: string[], allFriendlyUrlPaths: Set<string>): Promise<{ html: string;
       extractedStyles: string[]; extractedLinkStyles: string[]; extractedScriptPaths: string[] }> {
   let $;
   try {
     $ = cheerio.load(html);
     console.log('[rewriteAndDownloadAssets] Cheerio successfully loaded HTML.');
   } catch (cheerioError) {
     console.error(`[rewriteAndDownloadAssets] Error loading HTML into Cheerio. Problematic HTML (first 5000 chars): ${html.substring(0, 5000)}`, cheerioError);
     throw cheerioError; // Re-throw to propagate the error
   }

   const assetPromises: Promise<void>[] = [];
   const extractedStyleContents: string[] = [];
   const extractedLinkStylePaths: string[] = [];
   const extractedScriptPaths: string[] = [];

   // Rewrite img src and download
   console.log('[rewriteAndDownloadAssets] Processing <img> tags...');
   $('img').each((_i, img) => {
     const src = $(img).attr('src');
     if (src && src.startsWith('/')) {
       console.log(`[rewriteAndDownloadAssets] Found <img> with src: ${src}`);
       const originalAbsoluteUrl = new URL(src, baseUrl).toString();
       assetPromises.push(
         downloadAndRewriteAsset(originalAbsoluteUrl, 'images').then(newSrc => {
           $(img).attr('src', newSrc);
           console.log(`[rewriteAndDownloadAssets] Rewrote <img> src from ${originalAbsoluteUrl} to ${newSrc}`);
         })
       );
     }
   });
   console.log('[rewriteAndDownloadAssets] Finished processing <img> tags.');

   // Rewrite source srcset and download
   console.log('[rewriteAndDownloadAssets] Processing <source> tags...');
   $('source').each((_i, source) => {
     const srcset = $(source).attr('srcset');
     if (srcset) {
       console.log(`[rewriteAndDownloadAssets] Found <source> with srcset: ${srcset}`);
       const rewrittenSrcsetPromises = srcset.split(',').map(async s => {
         const parts = s.trim().split(' ');
         const url = parts[0];
         if (url && url.startsWith('/')) {
           console.log(`[rewriteAndDownloadAssets] Found <source> url in srcset: ${url}`);
           const originalAbsoluteUrl = new URL(url, baseUrl).toString();
           const newUrl = await downloadAndRewriteAsset(originalAbsoluteUrl, 'images');
           console.log(`[rewriteAndDownloadAssets] Rewrote <source> srcset url from ${originalAbsoluteUrl} to ${newUrl}`);
           return newUrl + (parts[1] ? ` ${parts[1]}` : '');
         }
         return s;
       });
       assetPromises.push(Promise.all(rewrittenSrcsetPromises).then(rewrittenParts => {
         $(source).attr('srcset', rewrittenParts.join(', '));
       }));
     }
   });
   console.log('[rewriteAndDownloadAssets] Finished processing <source> tags.');

  // Handle <svg><use href="..."> tags and inline SVG symbols
  console.log('[rewriteAndDownloadAssets] Processing <svg><use> tags...');
  $('svg use').each((_i, use) => {
    const href = $(use).attr('href');
    if (href) {
      console.log(`[rewriteAndDownloadAssets] Found <svg><use> with href: ${href}`);
      const parts = href.split('#');
      const svgSpriteBaseUrl = parts[0]; // This is the URL of the SVG sprite file (e.g., icons.svg)
      const fragmentId = parts[1]; // Get the ID without '#'

      // Only process internal SVG sprites that have a base URL
      if (svgSpriteBaseUrl && svgSpriteBaseUrl.startsWith(LIFERAY_HOST!)) {
        console.log(`[rewriteAndDownloadAssets] Processing internal SVG sprite reference: ${href}`);
        
        assetPromises.push(
          downloadAndRewriteAsset(svgSpriteBaseUrl, 'images').then(async localSvgSpritePath => { // Ensure download completes
            if (fragmentId) { // Only attempt inlining if there's a fragment ID
              try {
                // Read the content of the downloaded SVG sprite from the local file system
                // path.join(process.cwd(), 'public', localSvgSpritePath) creates the absolute path
                const svgContent = await fs.readFile(path.join(process.cwd(), 'public', localSvgSpritePath), 'utf8');
                const $svgSprite = cheerio.load(svgContent);
                const symbolElement = $svgSprite(`#${fragmentId}`);
                if (symbolElement.length) {
                  const innerSvgContent = symbolElement.html() || ''; // Default to empty string if null
                  const parentSvg = $(use).closest('svg');
                  if (parentSvg.length) {
                    const originalClass = parentSvg.attr('class') || '';
                    const originalRole = parentSvg.attr('role') || '';
                    const viewBox = symbolElement.attr('viewBox') || '';

                    let newSvgElement = `<svg class="${originalClass}" role="${originalRole}"`;
                    if (viewBox) {
                      newSvgElement += ` viewBox="${viewBox}"`;
                    }
                    newSvgElement += `>${innerSvgContent}</svg>`;
                    parentSvg.replaceWith(newSvgElement);
                    console.log(`[rewriteAndDownloadAssets] Inlined SVG symbol: ${fragmentId} from ${svgSpriteBaseUrl}`);
                  }
                } else {
                  console.warn(`[rewriteAndDownloadAssets] SVG symbol with ID ${fragmentId} not found in ${svgSpriteBaseUrl} (local path: ${localSvgSpritePath})`);
                }
              } catch (readError) {
                console.error(`[rewriteAndDownloadAssets] Error reading local SVG sprite file ${localSvgSpritePath}:`, readError);
              }
            } else {
                console.warn(`[rewriteAndDownloadAssets] SVG <use> tag has no fragment ID: ${href}`);
            }
          })
        );
      } else if (svgSpriteBaseUrl && !svgSpriteBaseUrl.startsWith(LIFERAY_HOST!)) {
        console.warn(`[rewriteAndDownloadAssets] External SVG sprite reference, leaving as is: ${href}`);
      }
    }
  });
  console.log('[rewriteAndDownloadAssets] Finished processing <svg><use> tags.');

   // Handle <a href="...">
   console.log('[rewriteAndDownloadAssets] Processing <a> tags...');
   $('a').each((_i, a) => {
     const href = $(a).attr('href');
     if (href) {
       console.log(`[rewriteAndDownloadAssets] Found <a> with href: ${href}`);
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
         // Case 1: Liferay's configured path prefix
         if (LIFERAY_PATH_PREFIX && potentialPath.startsWith(LIFERAY_PATH_PREFIX)) {
             const friendlyUrlPath = potentialPath.substring(LIFERAY_PATH_PREFIX.length);
             if (allFriendlyUrlPaths.has(friendlyUrlPath)) {
                 finalHref = `/pages${friendlyUrlPath}`;
                 isInternalLink = true;
             }
         }
         // Case 2: Direct relative path that matches a friendlyUrlPath (if no prefix or if prefix not matched)
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
       console.log(`[rewriteAndDownloadAssets] Rewrote <a> href from ${href} to ${finalHref}`);
     }
   });
   console.log('[rewriteAndDownloadAssets] Finished processing <a> tags.');

   // Handle <style> tags (inline CSS) - process content for internal url() references and extract
   console.log('[rewriteAndDownloadAssets] Processing <style> tags...');
   $('style').each((_i, styleTag) => {
     const cssContent = $(styleTag).html();
     if (cssContent) {
       console.log(`[rewriteAndDownloadAssets] Found <style> tag with content length: ${cssContent.length}`);
       assetPromises.push(
         processAndRewriteCssUrls(cssContent, baseUrl).then(newCssContent => {
           extractedStyleContents.push(newCssContent);
           $(styleTag).remove();
         })
       );
     }
   });
   console.log('[rewriteAndDownloadAssets] Finished processing <style> tags.');

   // --- Use discoveredCssUrls for external stylesheets ---
   // Remove existing <link rel="stylesheet"> tags from the HTML as they will be linked via props
   $('link[rel="stylesheet"]').remove();

   // Download and process DISCOVERED CSS URLs
   console.log('[rewriteAndDownloadAssets] Processing discovered CSS URLs...');
   const cssDownloadPromises = discoveredCssUrls.map(url => {
     console.log(`[rewriteAndDownloadAssets] Discovered CSS URL: ${url}`);
     return downloadAndRewriteAsset(url, 'styles').then(async localPath => {
       extractedLinkStylePaths.push(localPath);
       console.log(`[rewriteAndDownloadAssets] Downloaded CSS to: ${localPath}`);
       // Process content of this downloaded CSS file for internal URLs
       const rawCssContent = await fs.readFile(path.join(process.cwd(), 'public', localPath), 'utf8');
       const processedCssContent = await processAndRewriteCssUrls(rawCssContent, url);
       await fs.writeFile(path.join(process.cwd(), 'public', localPath), processedCssContent);
     });
   });
   assetPromises.push(...cssDownloadPromises);
   console.log('[rewriteAndRewriteAssets] Finished processing discovered CSS URLs.');

   // --- Use discoveredJsUrls for external scripts ---
   // Remove existing <script src> tags from the HTML as they will be re-rendered via props
   $('script[src]').remove();

   // Download DISCOVERED JS URLs
   console.log('[rewriteAndDownloadAssets] Processing discovered JS URLs...');
   const jsDownloadPromises = discoveredJsUrls.map(url => {
     console.log(`[rewriteAndDownloadAssets] Discovered JS URL: ${url}`);
     return downloadAndRewriteAsset(url, 'scripts').then(localPath => {
       extractedScriptPaths.push(localPath);
       console.log(`[rewriteAndDownloadAssets] Downloaded JS to: ${localPath}`);
     });
   });
   assetPromises.push(...jsDownloadPromises);
   console.log('[rewriteAndDownloadAssets] Finished processing discovered JS URLs.');

   // Handle style attributes with url() - for background images etc.
   console.log('[rewriteAndDownloadAssets] Processing elements with style attributes containing url()...');
   const styleAttrPromises: Promise<void>[] = [];
   $('[style*="url("]').each((_i, el) => {
     const styleAttr = $(el).attr('style');
     if (styleAttr) {
       const urlRegex = /url\((?!['"]?data:)(['"]?)(.*?)\1\)/g;
       const replacementsMap = new Map<string, string>(); // Map original full URL string to new local URL string
       let match: RegExpExecArray | null;

       // Collect all promises for assets in this style attribute
       const currentElementAssetPromises: Promise<void>[] = [];
       while ((match = urlRegex.exec(styleAttr)) !== null) {
         try {
           const originalUrlInAttr = match[2];
           if (originalUrlInAttr) {
             let absoluteUrl: string;
             try {
               absoluteUrl = new URL(originalUrlInAttr, baseUrl).toString();
             } catch (urlError) {
               console.warn(`[rewriteAndDownloadAssets] Malformed URL in style attribute: ${originalUrlInAttr}`, urlError);
               continue; // Skip this URL if it's malformed
             }

             if (absoluteUrl.startsWith(LIFERAY_HOST!)) {
                  currentElementAssetPromises.push(
                    downloadAndRewriteAsset(absoluteUrl, 'images').then(newLocalUrl => {
                      replacementsMap.set(originalUrlInAttr, newLocalUrl);
                    })
                  );
                }
              }
            } catch (e) {
              console.error(`[rewriteAndDownloadAssets] Error processing style attribute URL: ${match[0]}`, e);
            }
          }
   
          // After all assets for this element's style attribute are processed, apply replacements
          styleAttrPromises.push(
            Promise.all(currentElementAssetPromises).then(() => {
              let newStyleAttr = styleAttr;
              // Sort keys by length descending to ensure longer URLs are replaced first (e.g., specific image then generic folder)
              const sortedOriginalUrls = Array.from(replacementsMap.keys()).sort((a, b) => b.length - a.length);
   
              for (const originalUrlInAttr of sortedOriginalUrls) {
                const newLocalUrl = replacementsMap.get(originalUrlInAttr);
                if (newLocalUrl) {
                    // Ensure we replace the full original URL, including query parameters, within the url() wrapper
                    // Use a regex to find the specific url(...) part to replace
                    const regexToReplace = new RegExp(`url\\((['"]?)${escapeRegex(originalUrlInAttr)}\\1\\)`, 'g');
                    newStyleAttr = newStyleAttr.replace(regexToReplace, `url('${newLocalUrl}')`);
                }
              }
              $(el).attr('style', newStyleAttr);
            })
          );
        }
      });
   
      assetPromises.push(...styleAttrPromises); // Add all style attribute promises to the main assetPromises array
   
      console.log('[rewriteAndDownloadAssets] Finished processing elements with style attributes containing url().');
   
      await Promise.all(assetPromises)
        .then(() => console.log('[rewriteAndDownloadAssets] All asset promises resolved.'))
        .catch(error => {
          console.error('[rewriteAndDownloadAssets] Error resolving asset promises:', error);
          throw error; // Re-throw the error to propagate it
        });
   
      return { html: $.html(), extractedStyles: extractedStyleContents, extractedLinkStyles: extractedLinkStylePaths, extractedScriptPaths };
    }


export async function getLiferayScrapedContent(publicPageUrl: string, allFriendlyUrlPaths: Set<string>): Promise<{ html: string; extractedStyles: string[]; extractedLinkStyles: string[]; extractedScriptPaths: string[] }> {
  try {
    console.log(`[getLiferayScrapedContent] Scraping URL: ${publicPageUrl}`);
    const { html: fullHtml, discoveredCssUrls, discoveredJsUrls } = await getLiferayFullPageHtml(publicPageUrl);
    console.log(`[getLiferayScrapedContent] fullHtml length: ${fullHtml.length}. Snippet: ${fullHtml.substring(0, 500)}`);
    console.log(`[getLiferayScrapedContent] discoveredCssUrls:`, discoveredCssUrls);
    console.log(`[getLiferayScrapedContent] discoveredJsUrls:`, discoveredJsUrls);


    const { html: processedHtml, extractedStyles, extractedLinkStyles, extractedScriptPaths } = await rewriteAndDownloadAssets(fullHtml, LIFERAY_HOST!, discoveredCssUrls, discoveredJsUrls, allFriendlyUrlPaths); 
    
    const $ = cheerio.load(processedHtml);
    const bodyContent = $('body').html() || '';

    return { html: bodyContent, extractedStyles, extractedLinkStyles, extractedScriptPaths };
  } catch (error) {
    console.error(`Error getting Liferay page content from ${publicPageUrl}:`, error);
    throw error;
  }
}