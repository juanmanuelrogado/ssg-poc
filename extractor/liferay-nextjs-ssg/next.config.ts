import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export', // Add this line to enable static export

  images: {
    unoptimized: true, // Disable Next.js Image Optimization for static export
    remotePatterns: [ // Allow images from localhost:8080 (your Liferay instance)
      {
        protocol: 'http',
        hostname: 'localhost',
        port: '8080',
        pathname: '**',
      },
    ],
  },

  // Optional: Configure a base path if your static site will be served from a subpath
  // basePath: '/my-static-site', 

  /* config options here */
};

export default nextConfig;
