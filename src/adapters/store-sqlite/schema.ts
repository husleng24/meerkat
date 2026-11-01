/**
 * Schema 迁移：按 PRAGMA user_version 递增执行。
 * 规则：每条迁移只增不改（不改已发布的 SQL），新需求追加新版本。
 */

export interface Migration {
  version: number
  name: string
  up: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial',
    up: `
      CREATE TABLE sources (
        id            TEXT PRIMARY KEY,
        name          TEXT    NOT NULL,
        kind          TEXT    NOT NULL,
        url           TEXT,
        channel_id    TEXT,
        tier          INTEGER NOT NULL,
        bucket_hint   TEXT    NOT NULL,
        window_hours  INTEGER,
        always_keep   INTEGER NOT NULL DEFAULT 0,
        insecure      INTEGER NOT NULL DEFAULT 0,
        parser        TEXT,
        enabled       INTEGER NOT NULL DEFAULT 1,
        last_ok_at    INTEGER,
        fail_streak   INTEGER NOT NULL DEFAULT 0,
        last_error    TEXT,
        avg_items     REAL,
        avg_ms        INTEGER,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );

      CREATE TABLE items (
        id              TEXT PRIMARY KEY,
        source_id       TEXT    NOT NULL,
        title           TEXT    NOT NULL,
        url             TEXT    NOT NULL,
        author          TEXT,
        published_at    INTEGER,
        summary         TEXT    NOT NULL DEFAULT '',
        bucket          TEXT    NOT NULL,
        score           REAL    NOT NULL,
        formula_version INTEGER NOT NULL,
        points          INTEGER,
        comments        INTEGER,
        also_in         TEXT    NOT NULL DEFAULT '[]',
        fetched_at      INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_items_published ON items(published_at DESC);
      CREATE INDEX idx_items_source    ON items(source_id);
      CREATE INDEX idx_items_bucket    ON items(bucket);

      CREATE TABLE briefs (
        id          TEXT PRIMARY KEY,
        date        TEXT    NOT NULL,
        topic_id    TEXT    NOT NULL DEFAULT 'default',
        markdown    TEXT    NOT NULL,
        ir_json     TEXT,
        model       TEXT    NOT NULL,
        tokens_in   INTEGER NOT NULL DEFAULT 0,
        tokens_out  INTEGER NOT NULL DEFAULT 0,
        link_check  TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_briefs_date ON briefs(date DESC);

      -- 用标志位而不是互斥状态：一条可以既已读又收藏、且被写进过简报
      CREATE TABLE item_flags (
        item_id    TEXT PRIMARY KEY,
        is_read    INTEGER NOT NULL DEFAULT 0,
        is_saved   INTEGER NOT NULL DEFAULT 0,
        is_hidden  INTEGER NOT NULL DEFAULT 0,
        briefed_at INTEGER,
        noted_at   INTEGER,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_flags_briefed ON item_flags(briefed_at);

      CREATE TABLE runs (
        id          TEXT PRIMARY KEY,
        started_at  INTEGER NOT NULL,
        finished_at INTEGER,
        n_sources   INTEGER NOT NULL DEFAULT 0,
        n_raw       INTEGER NOT NULL DEFAULT 0,
        n_kept      INTEGER NOT NULL DEFAULT 0,
        errors_json TEXT
      );
      CREATE INDEX idx_runs_started ON runs(started_at DESC);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- trigram 分词：中文与英文都支持子串匹配（unicode61 对中文只能整词命中）
      CREATE VIRTUAL TABLE items_fts USING fts5(
        title, summary,
        content='items', content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER items_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, title, summary)
        VALUES (new.rowid, new.title, new.summary);
      END;
      CREATE TRIGGER items_ad AFTER DELETE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, summary)
        VALUES ('delete', old.rowid, old.title, old.summary);
      END;
      CREATE TRIGGER items_au AFTER UPDATE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, summary)
        VALUES ('delete', old.rowid, old.title, old.summary);
        INSERT INTO items_fts(rowid, title, summary)
        VALUES (new.rowid, new.title, new.summary);
      END;
    `
  },
  {
    version: 2,
    name: 'topics',
    up: `
      -- 主题：一个主题 = 一组源 + 一套排程 + 一条独立简报
      CREATE TABLE topics (
        id         TEXT PRIMARY KEY,
        name       TEXT    NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        hour       INTEGER NOT NULL DEFAULT 8,
        minute     INTEGER NOT NULL DEFAULT 30,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 源是全局的（健康度按源算），归属按主题算：一个源可以同时在多个主题里
      CREATE TABLE topic_sources (
        topic_id  TEXT NOT NULL,
        source_id TEXT NOT NULL,
        PRIMARY KEY (topic_id, source_id),
        FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
        FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
      );

      -- 「这条推送过」必须按主题记：A 主题推过的内容，B 主题还得能推
      CREATE TABLE brief_items (
        topic_id   TEXT    NOT NULL,
        item_id    TEXT    NOT NULL,
        briefed_at INTEGER NOT NULL,
        PRIMARY KEY (topic_id, item_id),
        FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_brief_items_time ON brief_items(briefed_at);

      -- 回填：既有数据全部归到「AI 综合」，用户升级后看到的仍是同一条简报
      INSERT INTO topics (id, name, enabled, hour, minute, created_at, updated_at)
      VALUES ('ai', 'AI 综合', 1, 8, 30,
              CAST(strftime('%s','now') AS INTEGER) * 1000,
              CAST(strftime('%s','now') AS INTEGER) * 1000);

      INSERT INTO topic_sources (topic_id, source_id) SELECT 'ai', id FROM sources;
      UPDATE briefs SET topic_id = 'ai' WHERE topic_id = 'default';

      INSERT INTO brief_items (topic_id, item_id, briefed_at)
      SELECT 'ai', item_id, briefed_at FROM item_flags WHERE briefed_at IS NOT NULL;
    `
  },
  {
    version: 3,
    name: 'chat',
    up: `
      -- 对话线程：每个主题每天一段（P0 的简化），标题取第一条消息前 16 字
      CREATE TABLE chat_threads (
        id         TEXT PRIMARY KEY,
        title      TEXT    NOT NULL,
        topic_id   TEXT    NOT NULL,
        brief_date TEXT,
        model      TEXT    NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived   INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chat_threads_slot ON chat_threads(topic_id, brief_date);

      CREATE TABLE chat_messages (
        id           TEXT PRIMARY KEY,
        thread_id    TEXT NOT NULL,
        role         TEXT NOT NULL,
        content      TEXT NOT NULL,
        model        TEXT,
        tokens_in    INTEGER,
        tokens_out   INTEGER,
        -- 只存引用（简报日期、条目 id），不存上下文正文
        context_json TEXT,
        created_at   INTEGER NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id, created_at);
    `
  }
]

export const LATEST_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0)
