const backendOrigin = process.env.SM_BACKEND_ORIGIN || 'http://localhost:8080';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  ...(process.env.NODE_ENV === 'development'
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
