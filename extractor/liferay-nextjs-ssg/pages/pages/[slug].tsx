// extractor/liferay-nextjs-ssg/pages/pages/[slug].tsx
import { GetStaticPaths, GetStaticProps } from 'next';
import DOMPurify from 'isomorphic-dompurify';
import { getLiferayContent, getLiferayRenderedHtml } from '../../src/lib/liferay';

interface ILiferayApiPage { // Represents the raw Liferay API page object
  id: number;
  title: string;
  friendlyUrlPath: string;
  renderedPage: {
    renderedPageURL: string;
  };
}

interface ILiferayPagePropsData { // Represents the processed data passed to the Page component
  id: number;
  title: string;
  friendlyUrlPath: string;
  renderedHtml: string;
}

interface PageProps {
  pageData: ILiferayPagePropsData | null;
  error?: string;
}

const siteId = 20118; // Your Liferay Site ID

// getStaticPaths will generate all static paths for Liferay pages
export const getStaticPaths: GetStaticPaths = async () => {
  let liferayPages: { friendlyUrlPath: string }[] = [];
  try {
    const sitePagesResponse = await getLiferayContent(`/v1.0/sites/${siteId}/site-pages`);
    if (sitePagesResponse && sitePagesResponse.items) {
      liferayPages = sitePagesResponse.items;
    }
  } catch (error) {
    console.error('Error fetching site pages for getStaticPaths:', error);
    // Log error, but return empty paths to allow Next.js to build without crashing
    return { paths: [], fallback: false };
  }

  const paths = liferayPages.map(page => ({
    params: { slug: page.friendlyUrlPath.substring(1) }, // Remove leading '/' for slug
  }));

  console.log('getStaticPaths generated paths:', paths);

  return {
    paths,
    fallback: false, // Set to 'blocking' or true if you want to use fallback pages
  };
};

// getStaticProps will fetch data for each individual page
export const getStaticProps: GetStaticProps<PageProps> = async ({ params }) => {
  const slug = params?.slug as string;
  const friendlyUrlPath = `/${slug}`;

  try {
    // 1. Fetch ALL site pages again (or use a global cache if available for build time)
    //    This is less efficient but ensures we get the full list and find the correct one locally.
    const allSitePagesResponse = await getLiferayContent(`/v1.0/sites/${siteId}/site-pages`);
    let targetPage: ILiferayApiPage | undefined; // Correctly use ILiferayApiPage here

    if (allSitePagesResponse && allSitePagesResponse.items) {
      targetPage = allSitePagesResponse.items.find((page: ILiferayApiPage) => page.friendlyUrlPath === friendlyUrlPath); // Correctly use ILiferayApiPage here
    }
    
    if (targetPage) { // Check if targetPage was actually found
      const renderedPageURL = targetPage.renderedPage.renderedPageURL;

      if (renderedPageURL) {
        const rawHtml = await getLiferayRenderedHtml(renderedPageURL);
        const renderedHtml = DOMPurify.sanitize(rawHtml);

        return {
          props: {
            pageData: {
              id: targetPage.id,
              title: targetPage.title,
              friendlyUrlPath: targetPage.friendlyUrlPath,
              renderedHtml,
            },
          },
        };
      } else {
        return { props: { pageData: null, error: `Rendered page URL not found for ${friendlyUrlPath} page.` } };
      }
    } else {
      return { props: { pageData: null, error: `Site page ${friendlyUrlPath} not found in Liferay for site ID ${siteId}.` } };
    }
  } catch (err: any) {
    console.error(`Error in getStaticProps for ${friendlyUrlPath}:`, err);
    return { props: { pageData: null, error: err.message || `Failed to fetch page content for ${friendlyUrlPath} from Liferay` } };
  }
};

// Page component to display the Liferay content
const LiferayPage = ({ pageData, error }: PageProps) => {
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
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col items-center justify-between py-8 px-4 bg-white dark:bg-black">
        <h1 className="text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50 mb-4">
          Liferay Page: {pageData.title} ({pageData.friendlyUrlPath})
        </h1>
        <div
          className="prose dark:prose-invert" // Use Tailwind Typography if available, or custom styles
          dangerouslySetInnerHTML={{ __html: pageData.renderedHtml }}
        />
      </main>
    </div>
  );
};

export default LiferayPage;
