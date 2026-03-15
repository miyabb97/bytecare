/** @type {import('next').NextConfig} */
const backendBaseUrl = process.env.BYTECARE_BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  // Increase outgoing HTTP keep-alive timeout so the proxy doesn't drop
  // long-running backend requests (e.g. TCM image scan)
  httpAgentOptions: {
    keepAliveMsecs: 60000,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**"
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
        pathname: "/**"
      }
    ]
  },
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${backendBaseUrl}/api/v1/:path*`
      }
    ];
  }
};

module.exports = nextConfig;
