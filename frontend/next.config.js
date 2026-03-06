/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**.amazonaws.com' },
    ],
  },
  // Allow Three.js and other WebGL libs that reference browser globals
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Stub browser-only modules on the server
      config.externals = [...(config.externals || []), { canvas: 'canvas' }]
    }
    config.resolve.alias = {
      ...config.resolve.alias,
      // silence mapbox-gl SSR warnings
      'mapbox-gl': 'mapbox-gl',
    }
    return config
  },
}

module.exports = nextConfig