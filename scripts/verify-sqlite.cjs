// P1-0 验证：better-sqlite3 在 Electron 45 的 Node 运行时（ABI 150）下能否正常加载与读写
// 刻意不调用 app.whenReady()：本环境 Chromium 初始化会崩，但原生模块验证不需要窗口
const fs = require('fs')
const path = require('path')

const OUT = path.join(__dirname, 'verify-result.json')
const res = { ts: new Date().toISOString(), ok: false, steps: [] }
const step = (k, v) => res.steps.push([k, v === undefined ? true : v])

try {
  const Database = require('better-sqlite3')
  step('better-sqlite3 加载', 'ok')
  step('electron', process.versions.electron)
  step('node', process.versions.node)
  step('electron_abi', process.versions.modules)
  step('node_abi', process.versions.napi || 'n/a')

  const dir = path.join(__dirname, '.tmp'); fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'test.db')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  step('journal_mode', db.pragma('journal_mode', { simple: true }))
  step('sqlite_version', db.prepare('select sqlite_version() v').get().v)

  db.exec(`
    CREATE TABLE items(id TEXT PRIMARY KEY, title TEXT, published_at INTEGER);
    CREATE INDEX idx_items_pub ON items(published_at);
    CREATE VIRTUAL TABLE items_fts USING fts5(title, content='items', content_rowid='rowid');
    CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
      INSERT INTO items_fts(rowid, title) VALUES (new.rowid, new.title);
    END;
  `)
  step('schema', 'table + index + fts5 + trigger')

  const ins = db.prepare('INSERT INTO items(id,title,published_at) VALUES (?,?,?)')
  db.transaction((rows) => rows.forEach((r) => ins.run(...r)))([
    ['a1', 'Gemini 4 Carbon 发布', 1761000000],
    ['a2', 'Anthropic S-1 数据流出', 1761000100],
    ['a3', 'Qwen4 支持 1M 上下文', 1761000200],
  ])
  step('inserted', db.prepare('select count(*) c from items').get().c)

  const hit = db.prepare("SELECT title FROM items_fts WHERE items_fts MATCH 'Carbon'").get()
  step('fts_match', hit && hit.title)
  if (!hit) throw new Error('FTS5 匹配失败')

  const ftsCount = db.prepare('select count(*) c from items_fts').get().c
  step('fts_trigger_rows', ftsCount)
  if (ftsCount !== 3) throw new Error('FTS 触发器未写入，应为 3 实为 ' + ftsCount)

  // 中文分词检索（验证 unicode61 对中文是否可用）
  const zh = db.prepare("SELECT count(*) c FROM items_fts WHERE items_fts MATCH '上下文'").get().c
  step('fts_chinese_match', zh)

  db.pragma('user_version = 3')
  step('user_version', db.pragma('user_version', { simple: true }))
  db.close()
  fs.rmSync(dir, { recursive: true, force: true })
  res.ok = true
} catch (e) {
  res.error = e.message
  if (/NODE_MODULE_VERSION/.test(e.message)) res.hint = 'ABI 不匹配 → 跑 electron-rebuild'
}

fs.writeFileSync(OUT, JSON.stringify(res, null, 2), 'utf8')
process.exit(res.ok ? 0 : 1)
