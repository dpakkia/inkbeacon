import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // a self-contained server for the Docker image (see Dockerfile); Vercel and
  // Netlify build their own way and don't need it
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
};

export default nextConfig;
