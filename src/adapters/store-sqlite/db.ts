import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { MIGRATIONS } from './schema'

export type { DB }

/**
 * 打开数据库并跑迁移。
 * - WAL：读写并发更好，崩溃后能从日志恢复
 * - foreign_keys：必须显式开，SQLite 默认关闭
 */
export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  migrate(db)
  return db
}

/** 幂等迁移：只跑 user_version 之后的版本 */
export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version)
  if (pending.length === 0) return

  for (const m of pending) {
    const apply = db.transaction(() => {
      db.exec(m.up)
      db.pragma(`user_version = ${m.version}`)
    })
    apply()
  }
}

export function schemaVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number
}
