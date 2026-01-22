import { Buffer } from 'buffer';
import * as cheerio from 'cheerio';
import * as path from 'path'; // Import path module
import * as fs from 'fs/promises'; // Import fs.promises for async file operations

const LIFERAY_API_ENDPOINT = process.env.LIFERAY_API_ENDPOINT;
const LIFERAY_API_EMAIL = process.env.LIFERAY_API_EMAIL;
const LIFERAY_API_PASSWORD = process.env.LIFERAY_API_PASSWORD;

if (!LIFERAY_API_ENDPOINT) {
  throw new Error('LIFERAY_API_ENDPOINT is not defined in .env.local');
}

// Prepare the authentication header once
let authHeader: string | undefined;
if (LIFERAY_API_EMAIL && LIFERAY_API_PASSWORD) {
  const credentials = `${LIFERAY_API_EMAIL}:${LIFERAY_API_PASSWORD}`;
  authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
} else {
  console.warn('LIFERAY_API_EMAIL or LIFERAY_API_PASSWORD not defined. Proceeding without Basic Auth.');
}

// Function to fetch JSON content from Liferay API (relative path)
export async function getLiferayContent(path: string = ''): Promise<any> {
  const url = `${LIFERAY_API_ENDPOINT}${path}`;
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

// Function to fetch raw HTML content from a full URL (e.g., renderedPageURL)
export async function getLiferayRenderedHtml(fullUrl: string): Promise<string> {
  try {
    const headers: HeadersInit = {
      'Accept': 'text/html', // Explicitly ask for HTML
    };

    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(fullUrl, {
      headers,
      next: { revalidate: 3600 }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Liferay rendered HTML from ${fullUrl}: ${response.status} - ${response.statusText}`);
    }

    const html = await response.text();
    return rewriteAndDownloadAssets(html); // Rewrite URLs
  } catch (error) {
    console.error(`Error fetching Liferay rendered HTML from ${fullUrl}:`, error);
    throw error;
  }
}

// New helper function to download an asset and return its local path
async function downloadAndRewriteAsset(originalAbsoluteUrl: string, assetType: string): Promise<string> {
  if (!originalAbsoluteUrl) {
    return '';
  }

  // Construct a unique filename based on the URL hash or last part of the path
  const urlPath = new URL(originalAbsoluteUrl).pathname;
  const filename = path.basename(urlPath);
  const fileExtension = path.extname(filename);
  const baseFilename = path.basename(filename, fileExtension);
  const hash = Buffer.from(originalAbsoluteUrl).toString('base64url').substring(0, 10); // Simple hash for uniqueness
  const localFilename = `${baseFilename}-${hash}${fileExtension}`;

  // Define local directory within public/assets/
  const localDir = path.join(process.cwd(), 'public', 'assets', assetType); // e.g., public/assets/images
  const localFilePath = path.join(localDir, localFilename);
  const publicPath = `/assets/${assetType}/${localFilename}`; // Path to be used in HTML

  // Ensure directory exists
  await fs.mkdir(localDir, { recursive: true });

  try {
    const response = await fetch(originalAbsoluteUrl, {
      headers: authHeader ? { 'Authorization': authHeader } : {},
    });

    if (!response.ok) {
      console.warn(`Failed to download asset from ${originalAbsoluteUrl}: ${response.status} - ${response.statusText}`);
      return originalAbsoluteUrl; // Return original URL if download fails
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(localFilePath, Buffer.from(arrayBuffer));
    return publicPath; // Return new local public path
  } catch (downloadError) {
    console.warn(`Error downloading asset from ${originalAbsoluteUrl}:`, downloadError);
    return originalAbsoluteUrl; // Return original URL if error occurs
  }
}

// Helper function to rewrite relative URLs in HTML (now also downloads)
async function rewriteAndDownloadAssets(html: string): Promise<string> {
  const $ = cheerio.load(html);

  const assetPromises: Promise<void>[] = [];

  // Rewrite img src and download
  $('img').each((_i, img) => {
    const src = $(img).attr('src');
    if (src) {
      const originalAbsoluteUrl = new URL(src, LIFERAY_API_ENDPOINT).toString();
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
        if (url) {
          const originalAbsoluteUrl = new URL(url, LIFERAY_API_ENDPOINT).toString();
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

  // Potentially rewrite other attributes like a[href], link[href], script[src]
  // For <a href="...">
  $('a').each((_i, a) => {
    const href = $(a).attr('href');
    if (href && href.startsWith('/')) {
      $(a).attr('href', new URL(href, LIFERAY_API_ENDPOINT).toString());
    }
  });

  // For <link href="..."> (stylesheets)
  $('link[rel="stylesheet"]').each((_i, link) => {
    const href = $(link).attr('href');
    if (href && href.startsWith('/')) {
      $(link).attr('href', new URL(href, LIFERAY_API_ENDPOINT).toString());
    }
  });

  // For <script src="...">
  $('script[src]').each((_i, script) => {
    const src = $(script).attr('src');
    if (src && src.startsWith('/')) {
      $(script).attr('src', new URL(src, LIFERAY_API_ENDPOINT).toString());
    }
  });


  await Promise.all(assetPromises); // Esperar a que todos los activos se procesen

  return $.html();
}