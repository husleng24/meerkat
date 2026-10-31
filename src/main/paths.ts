/**
 * 资源路径解析：开发态与打包后路径不同，这里收口成一处。
 *
 * 开发态：<项目>/resources/...、<项目>/brand/...
 * 打包后：<安装目录>/resources/resources/...（extraResources 落地位置）
 *
 * 为什么单独成文件：这条路径错了的表现是"打包后启动就崩"或"托盘没图标"，
 * 而在开发态完全正常——最容易漏测的一类问题。
 */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CANDIDATES = [
  // 打包后：process.resourcesPath/resources/...
  () => join(process.resourcesPath, 'resources'),
  // 开发态：<项目>/resources/...
  () => join(app.getAppPath(), 'resources'),
  // 兜底：相对于编译产物（out/main -> 项目根）
  () => join(__dirname, '../../resources')
]

export function resourceDir(): string {
  for (const make of CANDIDATES) {
    try {
      const p = make()
      if (existsSync(p)) return p
    } catch {
      // 继续尝试下一个
    }
  }
  return CANDIDATES[1]!()
}

/** 取 resources/ 下的文件绝对路径（不保证存在，调用方自行兜底） */
export function resourcePath(rel: string): string {
  return join(resourceDir(), rel)
}

export function resourceExists(rel: string): boolean {
  return existsSync(resourcePath(rel))
}

/** brand/ 下的图标：打包后与 resources 同级放置 */
export function brandPath(file: string): string {
  const packaged = join(process.resourcesPath, 'brand', file)
  if (existsSync(packaged)) return packaged
  const dev = join(app.getAppPath(), 'brand', file)
  if (existsSync(dev)) return dev
  return join(__dirname, '../../brand', file)
}
