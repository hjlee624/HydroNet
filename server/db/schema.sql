-- HydroNet 인증/RBAC + (향후) CRDT 영속 스키마 (PostgreSQL). ADR-002 참조.
-- 적용: psql "$DATABASE_URL" -f server/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- 사번/ID (엑셀 업로드로 시드)
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('developer','pm','user')),
  password_hash TEXT,                             -- scrypt; NULL=비밀번호 미설정
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  access_code_hash TEXT,                          -- scrypt; 프로젝트 접속코드
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('pm','user')),  -- 프로젝트 내 역할
  added_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);

-- P3(ADR-001): CRDT Y.Doc 바이너리 영속(room = projectId = documentName)
CREATE TABLE IF NOT EXISTS ydocs (
  name        TEXT PRIMARY KEY,
  data        BYTEA NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
