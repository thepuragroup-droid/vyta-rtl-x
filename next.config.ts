import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // pdfkit reads its built-in font metrics (data/Helvetica.afm, ...) from
  // __dirname at runtime. Bundled, __dirname points at .next/server/chunks
  // and the read fails with ENOENT, so load it from node_modules instead.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/pdfkit/js/data/**/*"],
  },
};

export default nextConfig;
