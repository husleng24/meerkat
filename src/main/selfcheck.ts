/**
 * Electron 侧的自检适配器：把真实的 app / nativeImage / fs 注入纯检查模块。
 * 逻辑本身在 src/app/selfcheck.ts，这里只做环境提供。
 */
import { app, nativeImage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runSelfCheck, type Check, type SelfCheckResult } from '../app/selfcheck'
import { brandPath, resourceDir, resourcePath } from './paths'

function tryRead(rel: string): string | undefined {
  try {
    const p = resourcePath(rel)
    if (!existsSync(p)) return undefined
    return readFileSync(p, 'utf8')
  } catch {
    return undefined
  }
}

export function runElectronSelfCheck(): SelfCheckResult & { reportPath: string } {
  const userData = app.getPath('userData')
  const documents = app.getPath('documents')

  const result = runSelfCheck({
    appVersion: app.getVersion(),
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      modules: process.versions.modules
    },
    userDataDir: userData,
    documentsDir: documents,
    readResource: tryRead,
    resourceDirLabel: resourceDir(),
    brandFile: (file) => {
      const p = brandPath(file)
      return existsSync(p) ? p : undefined
    },
    imageInfo: (path) => {
      const img = nativeImage.createFromPath(path)
      if (img.isEmpty()) return { ok: false, error: '解码为空' }
      const s = img.getSize()
      return { ok: true, width: s.width, height: s.height }
    },
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

  let reportPath = ''
  try {
    const dir = join(documents, 'Meerkat')
    mkdirSync(dir, { recursive: true })
    reportPath = join(dir, '自检报告.txt')
    writeFileSync(reportPath, result.lines.join('\n'), 'utf8')
  } catch {
    reportPath = '(报告写入失败)'
  }

  return { ...result, reportPath }
}

export type { Check }
