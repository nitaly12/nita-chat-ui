import type { NextConfig } from "next";

const reactAppApiUrl =
  process.env.REACT_APP_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE?.trim() ||
  "";

const nextConfig: NextConfig = {
  env: {
    /** CRA-style name; `getImageUrl` prepends this to relative upload paths in the browser. */
    REACT_APP_API_URL: reactAppApiUrl,
  },
  async rewrites() {
    /** Must match real Spring origin at build time; otherwise rewrites target localhost and uploads break in prod. */
    const backend = (
      process.env.BACKEND_BASE_URL ??
      process.env.NEXT_PUBLIC_API_BASE ??
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
