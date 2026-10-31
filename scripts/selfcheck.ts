/**
 * 纯 Node 自检：在**不需要 Electron 启动**的前提下验证数据层与资源布局。
 *
 * 存在理由：开发机上 Electron 的浏览器进程起不来（exit -36861），
 * `Meerkat --verify` 跑不了。但"应用能不能工作"这件事，绝大部分并不依赖 Chromium：
 * 数据库、原生模块、FTS、资源布局、图标文件，用普通 Node 全都能验。
 *
 * 用法：
 *   node --import tsx scripts/selfcheck.ts                 # 开发布局（项目根）
 *   node --import tsx scripts/selfcheck.ts release/win-unpacked   # 打包布局
 */
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { runSelfCheck } from '../src/app/selfcheck'

const root = resolve(process.argv[2] ?? join(__dirname, '..'))
const isPackagedLayout = existsSync(join(root, 'resources', 'resources', 'sources.json'))

/** 打包布局：<root>/resources/resources/*、<root>/resources/brand/* */
const resourceDir = isPackagedLayout ? join(root, 'resources', 'resources') : join(root, 'resources')
const brandDir = isPackagedLayout ? join(root, 'resources', 'brand') : join(root, 'brand')

/** 用一个临时 userData，避免污染真实数据 */
const userData = join(root, '.selfcheck-tmp')
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })

/** 只读 PNG 文件头拿尺寸，不依赖 electron.nativeImage */
function pngInfo(path: string): { ok: boolean; width?: number; height?: number; error?: string } {
  try {
    const buf = readFileSync(path)
    if (buf.length < 24) return { ok: false, error: '文件过小' }
    const sig = [0x89, 0x50, 0x4e, 0x47]
    for (let i = 0; i < 4; i += 1) if (buf[i] !== sig[i]) return { ok: false, error: '不是 PNG' }
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    if (width === 0 || height === 0) return { ok: false, error: '尺寸为 0' }
    return { ok: true, width, height }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

const result = runSelfCheck({
  appVersion: '0.0.1 (selfcheck)',
  versions: { node: process.versions.node, modules: process.versions.modules },
  userDataDir: userData,
  documentsDir: join(root, '.selfcheck-tmp', 'docs'),
  readResource: (rel) => {
    const p = join(resourceDir, rel)
    return existsSync(p) ? readFileSync(p, 'utf8') : undefined
  },
  resourceDirLabel: `${resourceDir}${isPackagedLayout ? '（打包布局）' : '（开发布局）'}`,
  brandFile: (file) => {
    const p = join(brandDir, file)
    return existsSync(p) ? p : undefined
  },
  imageInfo: pngInfo,
  ensureWritableDir: (dir) => {
    try {
      mkdirSync(dir, { recursive: true })
      const probe = join(dir, '.write-probe')
      writeFileSync(probe, 'ok', 'utf8')
      unlinkSync(probe)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
  now: Date.now()
})

for (const c of result.checks) {
  console.log(`${c.ok ? '[ OK ]' : '[FAIL]'} ${c.name} — ${c.detail}`)
}
console.log(`\n${result.ok ? '全部通过' : '存在失败项'}（${result.checks.filter((c) => c.ok).length}/${result.checks.length}）`)

const reportPath = join(homedir(), 'Documents', 'Meerkat', '自检报告-纯Node.txt')
try {
  mkdirSync(join(homedir(), 'Documents', 'Meerkat'), { recursive: true })
  writeFileSync(reportPath, result.lines.join('\n'), 'utf8')
  console.log(`报告：${reportPath}`)
} catch {
  console.log('报告写入失败（不影响结论）')
}

rmSync(userData, { recursive: true, force: true })
process.exit(result.ok ? 0 : 1)
