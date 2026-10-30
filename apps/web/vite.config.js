import dns from 'dns';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import preprocess from 'svelte-preprocess';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const nodeVersion = Number.parseInt(process.versions.node.match(/^(\d+)\./)?.[1] || '17', 10);

if (nodeVersion < 17) {
  dns.setDefaultResultOrder('verbatim');
}

/**
 * source-sandbox.js, the runtime of static/source-sandbox.html (lib/data/sources/extension-sandbox.ts
 * with QuickJS), as one classic script: the frame's opaque origin can't load module chunks
 * without CORS. Served by the dev server, emitted beside the static files by a build.
 * @returns {import('vite').Plugin}
 */
function sourceSandbox() {
  const entry = fileURLToPath(
    new URL('./src/lib/data/sources/extension-sandbox.ts', import.meta.url)
  );
  const bundle = async () => {
    const [result] = /** @type {import('vite').Rollup.RollupOutput[]} */ (
      await build({
        configFile: false,
        // QuickJS's emscripten module mentions import.meta (unused in the browser build): iife drops it.
        logLevel: 'error',
        build: {
          write: false,
          lib: { entry, formats: ['iife'], name: 'chimiSourceSandbox' }
        }
      })
    );
    return result.output[0].code;
  };
  return {
    name: 'source-sandbox',
    configureServer(server) {
      /** @type {Promise<string> | undefined} */
      let built;
      server.watcher.on('change', (file) => file === entry && (built = undefined));
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.split('?')[0].endsWith('/source-sandbox.js')) return next();
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await (built ??= bundle()));
      });
    },
    async generateBundle() {
      if (this.environment.name !== 'client') return;
      this.emitFile({ type: 'asset', fileName: 'source-sandbox.js', source: await bundle() });
    }
  };
}

/** @type {import('vite').UserConfig} */
const config = {
  plugins: [
    sourceSandbox(),
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
          // The image hosts are the covers "Find details" may save (lib/data/library/book-metadata.ts)
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
