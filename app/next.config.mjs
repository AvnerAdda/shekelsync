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
};

export default nextConfig;
