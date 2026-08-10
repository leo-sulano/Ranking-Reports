import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Serve api/sites.ts under `npm run dev`.
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
      // nothing on process.env. The handler reads process.env.SITES_API_KEY,
      // so load the unprefixed var explicitly and assign it.
      const env = loadEnv(mode, process.cwd(), '')
      if (env.SITES_API_KEY) process.env.SITES_API_KEY = env.SITES_API_KEY

      server.middlewares.use('/api/sites', async (req, res) => {
        try {
          const mod = await server.ssrLoadModule('/api/sites.ts')
          // `use('/api/sites', ...)` strips the mount prefix, so req.url is
          // '/?action=…'. The base is only there to satisfy the URL parser.
          const search = new URL(req.url ?? '/', 'http://localhost').searchParams
          const query = Object.fromEntries(search)

          const shim = {
            status(code: number) { res.statusCode = code; return shim },
            setHeader(name: string, value: string) { res.setHeader(name, value); return shim },
            json(body: unknown) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify(body))
              return shim
            },
            send(body: string) { res.end(body); return shim },
          }

          await mod.default({ method: req.method, query }, shim)
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, error: `Dev proxy failed: ${(err as Error).message}` }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), sitesApiDevServer(mode)],
}))
