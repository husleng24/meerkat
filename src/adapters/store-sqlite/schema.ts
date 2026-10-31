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
  }
]

export const LATEST_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0)
