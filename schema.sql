-- ==============================================================================
-- GunplaSet Cloudflare D1 Database Schema
-- Security Model: Zero-Tolerance, Parameterized Queries, Full Data Isolation
-- ==============================================================================

-- 1. 유저 계정 및 글로벌 익명 인구통계 테이블
--    개인 식별 정보(주민번호, 전화번호, 비밀번호 등) 원천 배제
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,                 -- Google OAuth 고유 Sub ID (암호화 해시)
    email TEXT,                               -- 사용자 이메일 (계정 표시 및 복구용)
    country TEXT DEFAULT 'KR',                -- 국가 (KR, JP, US 등 글로벌 국가코드)
    region TEXT,                              -- 세부 거주지역 (예: 서울, 도쿄, California 등 광역지자체/주)
    age_group TEXT,                           -- 연령대 ('10s', '20s', '30s', '40s', '50s+')
    gender TEXT DEFAULT 'U',                  -- 성별 ('M', 'F', 'U': 미선택)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 유저별 소장품 데이터 테이블 (1 User = 1 Compressed JSON Blob)
--    타인 접근 차단: user_id 외래키 및 JWT 토큰 본인 검증 강제
CREATE TABLE IF NOT EXISTS user_collections (
    user_id TEXT PRIMARY KEY,                 -- users.user_id 참조
    collection_data TEXT NOT NULL,            -- 소장 키트 ID, 보유상태(새것/조립중/완료), 메모, 위시리스트 JSON
    total_owned_count INTEGER DEFAULT 0,      -- 총 보유 수량 (통계 쿼리 최적화)
    wishlist_count INTEGER DEFAULT 0,         -- 총 위시리스트 수량
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- 3. 전 세계 건프라 빅데이터 실시간 집계 캐시 테이블 (초고속 랭킹 서빙)
CREATE TABLE IF NOT EXISTS global_kit_stats (
    kit_id TEXT PRIMARY KEY,                  -- master_kits.json 키트 ID
    owned_user_count INTEGER DEFAULT 0,       -- 해당 키트를 소장한 전 세계 총 유저 수
    wishlist_user_count INTEGER DEFAULT 0,    -- 위시리스트에 담은 전 세계 총 유저 수
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 성능 및 보안 색인(Index)
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);
CREATE INDEX IF NOT EXISTS idx_users_age ON users(age_group);
CREATE INDEX IF NOT EXISTS idx_collections_owned ON user_collections(total_owned_count);
CREATE INDEX IF NOT EXISTS idx_stats_owned ON global_kit_stats(owned_user_count DESC);
CREATE INDEX IF NOT EXISTS idx_stats_wishlist ON global_kit_stats(wishlist_user_count DESC);
