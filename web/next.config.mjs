const backendOrigin = process.env.SM_BACKEND_ORIGIN || 'http://localhost:8080';
const isDev = process.env.NODE_ENV === 'development';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only emit a static export for production. In dev we let Next.js render
  // dynamic routes normally so /servers/<real-id> works without having every
  // id baked into generateStaticParams().
  ...(isDev ? {} : { output: 'export' }),
  images: { unoptimized: true },
  trailingSlash: false,
  ...(isDev
    ? {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: `${backendOrigin}/api/:path*` },
            { source: '/ws/:path*', destination: `${backendOrigin}/ws/:path*` },
          ];
        },
      }
    : {}),
};

export default nextConfig;
