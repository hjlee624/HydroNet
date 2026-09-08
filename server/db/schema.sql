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

-- F07: 프로젝트 접근 요청 — 미배정 사용자가 담당자에게 배정을 요청하는 기록.
-- 요청 자체는 **어떤 권한도 부여하지 않는다**. 승인(project_members 삽입)만이 입장을 연다.
CREATE TABLE IF NOT EXISTS access_requests (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id)    ON DELETE CASCADE, -- 요청자
  reason          TEXT NOT NULL DEFAULT '',                                -- 요청 사유
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  requested_at    BIGINT NOT NULL,                                         -- 요청 시각(epoch ms)
  expires_at      BIGINT NOT NULL,                                         -- 만료(요청+7일). 기한이 지나면 'expired' 로 확정 저장
  decided_by      TEXT REFERENCES users(id) ON DELETE SET NULL,            -- 승인자/거절자
  decided_at      BIGINT,
  decision_reason TEXT NOT NULL DEFAULT ''                                 -- 거절 사유(거절 시 필수)
);
-- 기존 DB 마이그레이션: 만료를 저장 상태로 승격('expired' 허용). 만료가 표시용에 그치면
-- 기한 지난 대기 행이 남아 재요청이 영구히 409 로 막힌다(부분 UNIQUE 인덱스에 걸려서).
-- 부분 인덱스 술어엔 now() 를 못 쓰므로(비-immutable) 만료는 앱이 쓰기로 확정한다(pgRepo.js).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'access_requests_status_check'
               AND conrelid = 'access_requests'::regclass) THEN
    ALTER TABLE access_requests DROP CONSTRAINT access_requests_status_check;
  END IF;
  ALTER TABLE access_requests ADD CONSTRAINT access_requests_status_check
    CHECK (status IN ('pending','approved','rejected','expired'));
END $$;

-- 같은 프로젝트·사용자에 대한 '처리 대기' 요청은 하나만(거절/승인/만료 이력은 계속 쌓인다).
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_req_open
  ON access_requests(project_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_req_proj ON access_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_access_req_user ON access_requests(user_id);

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
