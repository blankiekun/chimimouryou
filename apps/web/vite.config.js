import dns from 'dns';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import preprocess from 'svelte-preprocess';

const nodeVersion = Number.parseInt(process.versions.node.match(/^(\d+)\./)?.[1] || '17', 10);

if (nodeVersion < 17) {
  dns.setDefaultResultOrder('verbatim');
}

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [
    sveltekit({
      compilerOptions: {
        // Svelte 5 still honours this in legacy (non-runes) mode: === checks, as with Svelte 4.
        // `runes` isn't set, so Svelte picks per component: one that uses runes compiles in runes
        // mode, where `immutable` is ignored (its deprecation warning is dropped below).
        immutable: true,
        warningFilter: (warning) => warning.code !== 'options_deprecated_immutable',
        // Component tests mount with `new Component({ target, props })`, Svelte 4's API.
        ...(process.env.VITEST ? { compatibility: { componentApi: 4 } } : {})
      },

      // Consult https://github.com/sveltejs/svelte-preprocess
      // for more information about preprocessors
      preprocess: [
        preprocess({
          postcss: true
        })
      ],

      // SvelteKit 3 dropped `$lib` for `#lib`; the alias keeps the app's imports as they are.
      alias: { $lib: 'src/lib' },
      adapter: adapter({
        fallback: '404.html'
      }),
      // Not part of upstream: book HTML can come from other people (shared sync folder), so
      // only this site's own scripts may run: no inline handlers, no javascript: URLs.
      // SvelteKit adds the hash of its inline bootstrap script. Frames, images and
      // connections stay open (Yomitan's popup, covers, AI and cloud APIs).
      csp: {
        mode: 'hash',
        directives: {
          'script-src': ['self'],
          'worker-src': ['self', 'blob:'],
          'object-src': ['none'],
          'base-uri': ['self'],
          // Book CSS is applied as is: no outside images, fonts or stylesheets to beacon to.
          // The image hosts are the covers "Find details" may save (lib/data/book-metadata.ts)
          // and Google Drive's and OneDrive's cover thumbnails (thumbnailLink, gdrive-handler.ts;
          // Graph thumbnails, onedrive-handler.ts: hosts from Microsoft's thumbnail docs).
          'img-src': [
            'self',
            'blob:',
            'data:',
            'https://s4.anilist.co',
            'https://t.vndb.org',
            'https://cdn.jiten.moe',
            'https://*.googleusercontent.com',
            'https://*.files.1drv.com',
            'https://*.onedrive.com',
            // The social hub's pictures and cover thumbnails (socialHubDefault in social-account.ts).
            // shortcut: another hub address (Settings → Social) shows presets and title cards
            // instead; fetch them as blobs if forks run their own hubs.
            'https://chimi-hub.blankiekun.workers.dev'
          ],
          'font-src': ['self', 'blob:', 'data:'],
          'style-src': ['self', 'unsafe-inline']
        }
      }
    })
  ],
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
