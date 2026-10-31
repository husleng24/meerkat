#!/usr/bin/env node
/**
 * 极简静态服务器，仅用于本地视觉验证（截图 React 渲染层）。
 * 用法: node scripts/serve-static.cjs <目录> [端口]
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const dir = path.resolve(process.argv[2] ?? '.')
const port = Number(process.argv[3] ?? 5177)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = path.join(dir, urlPath === '/' ? 'index.html' : urlPath)
    if (!file.startsWith(dir)) {
      res.writeHead(403).end('forbidden')
      return
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
      res.end(buf)
    })
  })
  .listen(port, '127.0.0.1', () => console.log(`serving ${dir} at http://127.0.0.1:${port}`))
