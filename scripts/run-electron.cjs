#!/usr/bin/env node
/**
 * 在本机跑 Electron 脚本的唯一正确方式。
 *
 * 两个坑（实测）：
 *  1. 环境里存在 ELECTRON_RUN_AS_NODE=1 → electron.exe 会退化成纯 node，
 *     require('electron').app 为空。必须删掉这个变量。
 *  2. 直接 `& electron.exe script` 从 PowerShell 调用会 0xC0000005 崩溃；
 *     必须带 --no-sandbox 并做 stderr/stdout 重定向。
 *
 * 用法：node scripts/run-electron.cjs scripts/verify-sqlite.cjs [额外参数...]
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const electronBin = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron')

if (!fs.existsSync(electronBin)) {
  console.error(`找不到 Electron 可执行文件: ${electronBin}\n请先运行 pnpm install`)
  process.exit(1)
}

const target = process.argv[2]
if (!target) {
  console.error('用法: node scripts/run-electron.cjs <脚本路径> [参数...]')
  process.exit(1)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE // ← 关键：不清掉会退化成纯 node

const args = [path.resolve(root, target), '--no-sandbox', ...process.argv.slice(3)]
const child = spawn(electronBin, args, {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})

let out = ''
child.stdout.on('data', (d) => (out += d.toString()))
child.stderr.on('data', (d) => (out += d.toString()))

child.on('exit', (code) => {
  const errLog = path.join(root, 'electron-stderr.log')
  fs.writeFileSync(errLog, out, 'utf8')
  console.log(out.trim() || '(无输出，详见 electron-stderr.log)')
  console.log(`\n[run-electron] exit=${code}`)
  process.exit(code ?? 1)
})
