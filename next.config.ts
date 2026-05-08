import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backend = (
      process.env.BACKEND_BASE_URL ??
      process.env.NEXT_PUBLIC_SOCKET_URL ??
      "http://localhost:8080"
    ).replace(/\/+$/, "");
    return [
      {
        source: "/backend/:path*",
        destination: `${backend}/:path*`,
      },
    ];
  },
};

export default nextConfig;
