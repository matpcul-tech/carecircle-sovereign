/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server (.next/standalone) so the Docker image is
  // small and runs with `node server.js` — no full node_modules needed.
  output: 'standalone',
};
module.exports = nextConfig;
