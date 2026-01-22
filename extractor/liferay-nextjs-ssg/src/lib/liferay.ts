import { Buffer } from 'buffer';

const LIFERAY_API_ENDPOINT = process.env.LIFERAY_API_ENDPOINT;
const LIFERAY_API_EMAIL = process.env.LIFERAY_API_EMAIL;
const LIFERAY_API_PASSWORD = process.env.LIFERAY_API_PASSWORD;

if (!LIFERAY_API_ENDPOINT) {
  throw new Error('LIFERAY_API_ENDPOINT is not defined in .env.local');
}

// Prepara la cabecera de autenticación una sola vez
let authHeader: string | undefined;
if (LIFERAY_API_EMAIL && LIFERAY_API_PASSWORD) {
  const credentials = `${LIFERAY_API_EMAIL}:${LIFERAY_API_PASSWORD}`;
  authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
} else {
  console.warn('LIFERAY_API_EMAIL or LIFERAY_API_PASSWORD not defined. Proceeding without Basic Auth.');
}

// Función para obtener contenido JSON de la API de Liferay (ruta relativa)
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

// Nueva función para obtener contenido HTML renderizado de una URL completa (ej. renderedPageURL)
export async function getLiferayRenderedHtml(fullUrl: string): Promise<string> {
  try {
    const headers: HeadersInit = {
      'Accept': 'text/html', // Pedir explícitamente HTML
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

    return await response.text();
  } catch (error) {
    console.error(`Error fetching Liferay rendered HTML from ${fullUrl}:`, error);
    throw error;
  }
}