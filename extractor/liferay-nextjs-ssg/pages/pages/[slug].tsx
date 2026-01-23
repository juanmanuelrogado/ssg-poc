// extractor/liferay-nextjs-ssg/pages/pages/[slug].tsx
import { GetStaticPaths, GetStaticProps } from 'next';
import DOMPurify from 'isomorphic-dompurify';
import Head from 'next/head'; // Import Head component
import { getLiferayApiContent, getLiferayScrapedContent } from '../../src/lib/liferay'; // Updated imports

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
  extractedStyles?: string[]; // Prop for inline CSS
  extractedLinkStyles?: string[]; // Prop for linked CSS (local paths)
  extractedScriptPaths?: string[]; // Prop for linked JS (local paths)
}

const siteId = 20118; // Your Liferay Site ID

export const getStaticPaths: GetStaticPaths = async () => {
  let liferayPages: { friendlyUrlPath: string }[] = [];
  try {
    const sitePagesResponse = await getLiferayApiContent(`/v1.0/sites/${siteId}/site-pages`); // Use new API content getter
    if (sitePagesResponse && sitePagesResponse.items) {
      liferayPages = sitePagesResponse.items;
    }
  } catch (error) {
    console.error('Error fetching site pages for getStaticPaths:', error);
    return { paths: [], fallback: false };
  }

  const paths = liferayPages.map(page => ({
    params: { slug: page.friendlyUrlPath.substring(1) },
  }));

  console.log('getStaticPaths generated paths:', paths);

  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<PageProps> = async ({ params }) => {
  const slug = params?.slug as string;
  const friendlyUrlPath = `/${slug}`;

  try {
    const allSitePagesResponse = await getLiferayApiContent(`/v1.0/sites/${siteId}/site-pages`); // Use new API content getter
    let targetPage: ILiferayApiPage | undefined;

    if (allSitePagesResponse && allSitePagesResponse.items) {
      targetPage = allSitePagesResponse.items.find((page: ILiferayApiPage) => page.friendlyUrlPath === friendlyUrlPath);
    }
    
    if (targetPage) {
      // Construct the public-facing URL for Puppeteer
      const publicLiferayPageUrl = `${process.env.LIFERAY_HOST}/web/guest${friendlyUrlPath}`; // Use LIFERAY_HOST
      
      const { html: rawHtml, extractedStyles, extractedLinkStyles, extractedScriptPaths } = await getLiferayScrapedContent(publicLiferayPageUrl); // Use new scraped content getter
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
      {/* Minimal wrapper to avoid interference from Next.js's default styles/layout */}
      <div className="liferay-extracted-page">
        <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50 mb-4">
          Liferay Page: {pageData!.title} ({pageData!.friendlyUrlPath})
        </h1>
        <div
          className="prose dark:prose-invert" // Use Tailwind Typography if available, or custom styles
          dangerouslySetInnerHTML={{ __html: pageData!.renderedHtml }}
        />
      </div>
    </>
  );
};

export default LiferayPage;