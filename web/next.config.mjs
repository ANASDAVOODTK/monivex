/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  ...(process.env.NODE_ENV === 'development'
    ? {
        async rewrites() {
          return [
            { source: '/api/:path*', destination: 'http://localhost:8080/api/:path*' },
            { source: '/ws/:path*', destination: 'http://localhost:8080/ws/:path*' },
          ];
        },
      }
    : {}),
};

export default nextConfig;
