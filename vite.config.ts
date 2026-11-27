import { defineConfig, loadEnv, type PluginOption, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const GSC_ENDPOINTS = ['gsc-connect', 'gsc-callback', 'gsc-disconnect', 'gsc-status', 'gsc-keywords']

/** Mounts api/<name>.ts at `route`, adapting Node's req/res to the Vercel handler signature. */
function mountApi(server: ViteDevServer, route: string) {
  server.middlewares.use(route, async (req, res) => {
    try {
      const mod = await server.ssrLoadModule(`${route}.ts`)
      // `use(route, ...)` strips the mount prefix, so req.url is '/?action=…'.
      // The base is only there to satisfy the URL parser.
      const query = Object.fromEntries(new URL(req.url ?? '/', 'http://localhost').searchParams)

      const shim = {
        status(code: number) { res.statusCode = code; return shim },
        setHeader(name: string, value: string) { res.setHeader(name, value); return shim },
        json(body: unknown) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(body))
          return shim
        },
        send(body: string) { res.end(body); return shim },
        redirect(code: number, url: string) {
          res.statusCode = code
          res.setHeader('Location', url)
          res.end()
          return shim
        },
      }

      // Headers must be forwarded: handlers authenticate the caller from
      // `Authorization` (and the Google callback reads the nonce cookie).
      await mod.default({ method: req.method, query, headers: req.headers }, shim)
    } catch (err) {
      // This middleware exists to be debugged by hand; a JSON 500 in the
      // browser with no stack in the terminal defeats the whole point.
      console.error(`[dev] ${route} failed`, err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: false, error: `Dev proxy failed: ${(err as Error).message}` }))
    }
  })
}

/**
 * Serve api/sites.ts and api/gsc-*.ts under `npm run dev`.
 *
 * Vercel runs the functions in api/ in production; the Vite dev server does
 * not, so without this the Sync button gets index.html back. Rather than keep
 * a second dev-only proxy free to drift from the real one, adapt Node's
 * req/res to the Vercel handler signature and call the real handler.
 */
function sitesApiDevServer(mode: string): PluginOption {
  return {
    name: 'sites-api-dev-server',
    apply: 'serve',
    configureServer(server) {
      // Vite only puts VITE_-prefixed vars on import.meta.env, and puts
      // nothing on process.env. The handler reads process.env directly — for
      // the API key and for the Supabase config it verifies caller tokens
      // against — so copy those across explicitly.
      const env = loadEnv(mode, process.cwd(), '')
      for (const name of [
        'AHREFS_API_KEY',
        'SUPABASE_URL', 'VITE_SUPABASE_URL',
        'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
        'APP_URL', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GSC_STATE_SECRET', 'GSC_TOKEN_KEY',
      ]) {
        if (env[name]) process.env[name] = env[name]
      }

      mountApi(server, '/api/sites')
      for (const name of GSC_ENDPOINTS) mountApi(server, `/api/${name}`)
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), sitesApiDevServer(mode)],
}))
