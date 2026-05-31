const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  // Run the normal vite build
  execSync('vite build --config vite.config.ts', { stdio: 'inherit' });

  // The built files are in dist/public
  const source = path.resolve(__dirname, 'dist/public');

  // Possible locations Vercel might look
  const destinations = [
    path.resolve(__dirname, 'public'), // if Root is artifacts/jg-youth and outDir is public
    path.resolve(__dirname, 'dist'), // if Root is artifacts/jg-youth and outDir is dist
    path.resolve(__dirname, '../../public'), // if Root is repo root and outDir is public
    path.resolve(__dirname, '../../dist') // if Root is repo root and outDir is dist
  ];

  destinations.forEach(dest => {
    if (dest === source) return;
    try {
      // recursively copy source to dest
      fs.cpSync(source, dest, { recursive: true, force: true });
      console.log(`Copied build output to ${dest}`);
    } catch (err) {
      console.error(`Failed to copy to ${dest}:`, err.message);
    }
  });
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}
