import dns from 'dns';
import { sveltekit } from '@sveltejs/kit/vite';

const nodeVersion = Number.parseInt(process.versions.node.match(/^(\d+)\./)?.[1] || '17', 10);

if (nodeVersion < 17) {
  dns.setDefaultResultOrder('verbatim');
}

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [sveltekit()],
  ssr: {
    // https://github.com/FortAwesome/Font-Awesome/issues/18677
    noExternal: ['@fortawesome/*', '@popperjs/*']
  },
  // Every worker is created with type: 'module'; ES output lets them code-split (the WebP encoder)
  worker: {
    format: 'es'
  },
  experimental: {
    prebundleSvelteLibraries: true
  }
};

export default config;
