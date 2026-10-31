/**
 * 开机自启。
 *
 * 为什么这件事是"致命"的：整个产品卖的是"每天自动"，但如果用户重启过电脑，
 * 应用不在了，08:30 永远不会触发——而且用户不知道为什么。
 *
 * 两个平台差异要处理：
 *  - 便携版（portable）每次运行会解压到临时目录，注册表里记的路径会失效，
 *    所以**必须禁用**并如实告诉用户；
 *  - 开发态（electron .）注册的是 electron.exe，会污染系统启动项，也禁用。
 */
import { app } from 'electron'
import type { Store } from '../core/ports/store'
import { log } from './log'

const KEY = 'app.openAtLogin'

/** electron-builder 的 portable 目标会注入这个变量 */
export function isPortableBuild(): boolean {
  return Boolean(process.env['PORTABLE_EXECUTABLE_FILE'])
}

export interface AutoLaunchState {
  enabled: boolean
  supported: boolean
  /** 不支持时的原因，直接显示给用户 */
  reason?: string
}

export function desired(store: Store): boolean {
  const v = store.settings.get<boolean>(KEY)
  return v === undefined ? true : v
}

export function supported(): boolean {
  return app.isPackaged && !isPortableBuild()
}

export function state(_store: Store): AutoLaunchState {
  if (!supported()) {
    return {
      enabled: false,
      supported: false,
      reason: isPortableBuild()
        ? '便携版每次运行会解压到临时目录，无法注册开机自启。请改用 zip 解压版。'
        : '开发态不注册开机自启'
    }
  }
  const actual = app.getLoginItemSettings().openAtLogin
  return { enabled: actual, supported: true }
}

/** 把设置同步到系统。返回实际生效的状态 */
export function apply(store: Store): AutoLaunchState {
  if (!supported()) return state(store)
  const want = desired(store)
  try {
    app.setLoginItemSettings({ openAtLogin: want })
    const actual = app.getLoginItemSettings().openAtLogin
    log('info', `开机自启：期望=${want} 实际=${actual}`)
    return { enabled: actual, supported: true }
  } catch (e) {
    log('warn', `开机自启设置失败: ${e instanceof Error ? e.message : String(e)}`)
    return { enabled: false, supported: true, reason: '系统拒绝修改启动项' }
  }
}

export function setEnabled(store: Store, enabled: boolean): AutoLaunchState {
  store.settings.set(KEY, enabled)
  return apply(store)
}
