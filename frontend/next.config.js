/** @type {import('next').NextConfig} */
const backendBaseUrl = process.env.BYTECARE_BACKEND_URL || "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
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
