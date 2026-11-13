
/** @type {import('next').NextConfig} */

const nextConfig = {
  output: 'standalone',

  // Permit the local hostname used by Playwright in CI.
  allowedDevOrigins: [
    '127.0.0.1',
    'localhost',
  ],
};

module.exports = nextConfig;
