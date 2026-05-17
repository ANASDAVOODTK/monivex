const backendOrigin = process.env.SM_BACKEND_ORIGIN || 'http://localhost:8080';
// `next dev` doesn't always set NODE_ENV reliably across versions, so detect
// the runtime command directly as a belt-and-braces check.
const isDev =
  process.env.NODE_ENV === 'development' ||
  process.env.NEXT_PHASE === 'phase-development-server' ||
  process.argv.includes('dev');

const extraDevOrigins = (process.env.SM_DEV_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
        // Avoid the cross-origin warning when you reach the dev server over a
        // LAN IP instead of localhost. Add more via SM_DEV_ORIGINS=ip1,ip2.
        allowedDevOrigins: ['localhost', '127.0.0.1', '0.0.0.0', ...extraDevOrigins],
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
