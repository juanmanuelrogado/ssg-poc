import { GetStaticPaths, GetStaticProps } from 'next';
import DOMPurify from 'isomorphic-dompurify';
import Head from 'next/head';
import { getLiferayApiContent, getLiferayScrapedContent } from '../../src/lib/liferay';
import * as fs from 'fs/promises';
import * as path from 'path';

interface ILiferayApiPage {
  id: number;
  title: string;
  friendlyUrlPath: string;
  renderedPage: {
    renderedPageURL: string;
  };
}

interface ILiferayPagePropsData {
  id: number;
  title: string;
  friendlyUrlPath: string;
  renderedHtml: string;
}

interface PageProps {
  pageData: ILiferayPagePropsData | null;
  error?: string;
  extractedStyles?: string[];
  extractedLinkStyles?: string[];
  extractedScriptPaths?: string[];
}

export const getStaticPaths: GetStaticPaths = async () => {
  const pagesFilePath = path.join(process.cwd(), 'pages-to-build.json');
  let pagesToBuild: any[] = [];

  try {
    const fileContent = await fs.readFile(pagesFilePath, 'utf-8');
    pagesToBuild = JSON.parse(fileContent);
    console.log(`[getStaticPaths] Found pages-to-build.json, using ${pagesToBuild.length} pages from webhook.`);
  } catch (error) {
    console.log("[getStaticPaths] pages-to-build.json not found. Falling back to fetching all site pages from Liferay API.");
    const siteId = process.env.LIFERAY_SITE_ID;
    if (!siteId) {
      throw new Error('LIFERAY_SITE_ID is not defined in .env.local');
    }
    const allSitePagesResponse = await getLiferayApiContent(`/v1.0/sites/${siteId}/site-pages`, 100);
    pagesToBuild = allSitePagesResponse.items;
  }

  const paths = pagesToBuild.map((page: any) => ({
    params: { slug: page.friendlyUrlPath.substring(1).split('/') },
  }));

  return {
    paths,
    fallback: 'blocking',
  };
};

export const getStaticProps: GetStaticProps<PageProps> = async ({ params }) => {
  const siteId = process.env.LIFERAY_SITE_ID;
  if (!siteId) {
    throw new Error('LIFERAY_SITE_ID is not defined in .env.local');
  }

  const slugParts = params?.slug as string[];
  const friendlyUrlPath = `/${slugParts.join('/')}`;

  try {
    const allSitePagesResponse = await getLiferayApiContent(`/v1.0/sites/${siteId}/site-pages`, 100);
    let targetPage: ILiferayApiPage | undefined;
    const allFriendlyUrlPaths = new Set<string>();

    if (allSitePagesResponse && allSitePagesResponse.items) {
      allSitePagesResponse.items.forEach((page: ILiferayApiPage) => {
        allFriendlyUrlPaths.add(page.friendlyUrlPath);
      });
      targetPage = allSitePagesResponse.items.find((page: ILiferayApiPage) => page.friendlyUrlPath === friendlyUrlPath);
    }

    if (targetPage) {
      const liferayPathPrefix = process.env.LIFERAY_PATH_PREFIX || '';
      const publicLiferayPageUrl = `${process.env.LIFERAY_HOST}${liferayPathPrefix}${friendlyUrlPath}`;
      
      const { html: rawHtml, extractedStyles, extractedLinkStyles, extractedScriptPaths } = await getLiferayScrapedContent(publicLiferayPageUrl, allFriendlyUrlPaths);
      const renderedHtml = DOMPurify.sanitize(rawHtml);

      return {
        props: {
          pageData: {
            id: targetPage.id,
            title: targetPage.title,
            friendlyUrlPath: targetPage.friendlyUrlPath,
            renderedHtml,
          },
          extractedStyles,
          extractedLinkStyles,
          extractedScriptPaths,
        },
      };
    } else {
      return { props: { pageData: null, error: `Site page ${friendlyUrlPath} not found in Liferay for site ID ${siteId}.` } };
    }
  } catch (err: any) {
    console.error(`Error in getStaticProps for ${friendlyUrlPath}:`, err);
    return { props: { pageData: null, error: err.message || `Failed to fetch page content for ${friendlyUrlPath} from Liferay` } };
  }
};

const LiferayPage = ({ pageData, error, extractedStyles, extractedLinkStyles, extractedScriptPaths }: PageProps) => {
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <p className="max-w-md text-lg leading-8 text-red-600 dark:text-red-400">
          Error: {error}
        </p>
      </div>
    );
  }

  if (!pageData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Loading Liferay page data...
        </p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{pageData.title}</title>
        {extractedLinkStyles && extractedLinkStyles.map((path, index) => (
          <link key={`link-css-${index}`} rel="stylesheet" href={path} />
        ))}
        {extractedStyles && extractedStyles.map((style, index) => (
          <style key={`inline-css-${index}`} dangerouslySetInnerHTML={{ __html: style }} />
        ))}
        {extractedScriptPaths && extractedScriptPaths.map((path, index) => (
          <script key={`script-${index}`} src={path} defer />
        ))}
      </Head>
      <div className="liferay-extracted-page">
        <div
          className="prose dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: pageData!.renderedHtml }}
        />
      </div>
    </>
  );
};

export default LiferayPage;