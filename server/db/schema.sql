-- Sequence 인증/RBAC + (향후) CRDT 영속 스키마 (PostgreSQL). ADR-002 참조.
-- 적용: psql "$DATABASE_URL" -f server/db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- 사번/전화번호 ID
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('developer','pm','user')),
  division      TEXT,                             -- 소속 본부 키(개발자는 NULL=전체). client/src/data/divisions.ts
  password_hash TEXT,                             -- scrypt; NULL=비밀번호 미설정
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  pending       BOOLEAN NOT NULL DEFAULT FALSE,   -- 관리자(PM) 셀프등록 후 개발자 승인 대기
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 기존 DB 마이그레이션
ALTER TABLE users ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  access_code_hash TEXT,                          -- scrypt; 프로젝트 접속코드
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE, -- 개발자가 비활성화하면 일반 사용자 목록·입장에서 제외
  division         TEXT,                          -- 소속 본부 키. 같은 본부만 조회/입장 가능(개발자는 전체)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 기존 DB 마이그레이션(컬럼이 없으면 추가).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS division TEXT;

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
