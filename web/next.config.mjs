/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  async rewrites() {
    // Only used during `next dev` — proxies API + WS to the Go backend on :8080
    return [
      { source: '/api/:path*', destination: 'http://localhost:8080/api/:path*' },
      { source: '/ws/:path*', destination: 'http://localhost:8080/ws/:path*' },
    ];
  },
};
export default nextConfig;
