import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/*': ['./skills/character-deep-analysis/**/*'],
  },
};

export default nextConfig;
