const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Run the Vite build. Vite is configured to emit into dist/public.
execSync('vite build --config vite.config.ts', { stdio: 'inherit' });

const source = path.resolve(__dirname, 'dist/public');

// Vercel's Root Directory is the repo root and outputDirectory is "public",
// so the one correct destination is repo-root/public.
const dest = path.resolve(__dirname, '../../public');

if (!fs.existsSync(source)) {
  console.error(`Build output not found at ${source}`);
  process.exit(1);
}

// Replace any previous output, then copy. Any failure here must fail the build.
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(source, dest, { recursive: true });
console.log(`Copied build output to ${dest}`);
