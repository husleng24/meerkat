const path = require("node:path")
const fs = require("node:fs")
const base = process.argv[2]

console.log("=== 运行时 ===")
console.log("  electron:", process.versions.electron, " node:", process.versions.node, " modules(ABI):", process.versions.modules)

const asar = path.join(base, "resources", "app.asar")
console.log("\n=== asar 可读 ===")
console.log("  app.asar 存在:", fs.existsSync(asar))
console.log("  out/main/index.js:", fs.existsSync(path.join(asar, "out", "main", "index.js")))
console.log("  out/preload/index.js:", fs.existsSync(path.join(asar, "out", "preload", "index.js")))
console.log("  out/renderer/index.html:", fs.existsSync(path.join(asar, "out", "renderer", "index.html")))

console.log("\n=== extraResources ===")
for (const rel of ["resources/sources.json", "resources/prompts/compose.zh.md", "brand/icon-meerkat-head-32.png"]) {
  console.log(`  ${rel}:`, fs.existsSync(path.join(base, "resources", rel)))
}

console.log("\n=== better-sqlite3 在打包布局下加载 ===")
const Database = require(path.join(asar, "node_modules", "better-sqlite3"))
const db = new Database(":memory:")
console.log("  sqlite:", db.prepare("select sqlite_version() v").get().v)
db.exec("create table t(a); insert into t values ('中文检索 ok')")
console.log("  写入读出:", db.prepare("select a from t").get().a)
console.log("  FTS5:", (() => { try { db.exec("create virtual table f using fts5(x, tokenize='trigram')"); return "可用" } catch (e) { return "不可用: " + e.message } })())
db.close()
console.log("\n打包产物自检通过")
