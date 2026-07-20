/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project. Without it, Next infers the root
  // from a stray ~/package-lock.json and resolves node_modules from the wrong
  // place (breaking TypeScript detection during build).
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
