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
  reset_requested      BOOLEAN NOT NULL DEFAULT FALSE, -- 비밀번호 초기화 요청(관리자 처리 대기)
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE, -- 구 정책 비밀번호 → 다음 로그인 시 강제 변경
  pending_at           BIGINT,                          -- 승인 요청(셀프등록) 시각(epoch ms)
  reset_requested_at   BIGINT,                          -- 비밀번호 초기화 요청 시각(epoch ms)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 기존 DB 마이그레이션
ALTER TABLE users ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_requested_at BIGINT;

CREATE TABLE IF NOT EXISTS projects (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL DEFAULT '',
  access_code_hash TEXT,                          -- scrypt; 프로젝트 접속코드
  created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE, -- 개발자가 비활성화하면 일반 사용자 목록·입장에서 제외
  division         TEXT,                          -- 소속 본부 키. 같은 본부만 조회/입장 가능(개발자는 전체)
  sample           BOOLEAN NOT NULL DEFAULT FALSE, -- 체험존: 같은 본부 누구나 배정 없이 입장·편집
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 기존 DB 마이그레이션(컬럼이 없으면 추가).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS division TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sample BOOLEAN NOT NULL DEFAULT FALSE;

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
-- #20: 프로젝트 삭제 시 라이브 CRDT 고아 방지 — 정합성 정리 후 FK(ON DELETE CASCADE) 추가(멱등).
-- 앱 코드(deleteYDoc)와 별개 방어선. 기존 고아 row가 있으면 먼저 지워야 FK가 걸린다.
DELETE FROM ydocs WHERE name NOT IN (SELECT id FROM projects);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ydocs_name_project_fk') THEN
    ALTER TABLE ydocs ADD CONSTRAINT ydocs_name_project_fk
      FOREIGN KEY (name) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
END $$;
