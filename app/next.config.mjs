/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    '@mui/material',
    '@mui/x-date-pickers',
    '@mui/x-charts',
  ],
  modularizeImports: {
    '@mui/material': {
      transform: '@mui/material/{{member}}',
    },
    '@mui/icons-material': {
      transform: '@mui/icons-material/{{member}}',
    },
  },
  // Configure for Electron static export
  output: process.env.BUILD_MODE === 'electron' ? 'export' : undefined,
  trailingSlash: process.env.BUILD_MODE === 'electron',
  images: {
    unoptimized: process.env.BUILD_MODE === 'electron'
  },
  assetPrefix: process.env.BUILD_MODE === 'electron' ? './' : undefined,
};

export default nextConfig;
