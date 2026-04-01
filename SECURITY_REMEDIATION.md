# Security Remediation Plan

Generated from STRIDE threat model analysis on 2026-04-01.
See `.factory/threat-model.md` for full details.

---

## CRITICAL

- [x] **S-4: Remove hardcoded default encryption key**
  - File: `src/index.ts`, `src/config/config.ts`
  - Issue: Fallback `'default-key-32-chars-long!!!!!'` used when `TOKEN_ENCRYPTION_KEY` is not set
  - Fix: Made `TOKEN_ENCRYPTION_KEY` required for both `api_key` and `oauth` modes; rejects weak/default keys at startup with insecure-key blocklist

## HIGH

- [x] **D-1: Apply rate limiting to bot endpoint**
  - File: `src/index.ts`
  - Issue: Rate limiter middleware defined in `src/middleware/rateLimit.ts` but never applied to `POST /api/messages`
  - Fix: Added `BOT_MESSAGES` rate limiter to `/api/messages` route; created separate stricter `oauthRateLimiter` for all OAuth routes; also redacted `body` from request logs (I-1 partial fix)

- [x] **S-1: Fix broken PKCE implementation**
  - File: `src/services/oauth.ts`, `src/services/tokenStorage.ts`, `src/types/oauth.types.ts`
  - Issue: OAuth `state` (UUID, 36 chars) reused as PKCE `code_verifier`; verifier exposed in authorization URL
  - Fix: Generated separate random `code_verifier` (43+ chars via `crypto.randomBytes(32).toString('base64url')`); stored in `pending_auth_states` DB table; only S256 hash sent as `code_challenge`; removed inline `require('crypto')` in favor of top-level import

- [x] **S-2: Add authentication to OAuth management routes**
  - File: `src/routes/oauth.ts`
  - Issue: `/auth/oauth/status` and `/auth/oauth/revoke` accept any `userId` without authentication
  - Fix: Added HMAC-SHA256 signature validation (using `BOT_PASSWORD`/`BOT_ID` as secret); requests require `signature` + `timestamp` params; timestamps older than 5 minutes rejected; timing-safe comparison used; exported `generateInternalSignature()` for bot-side usage; also applied `escapeHTML()` to OAuth HTML responses (I-2 fix)

- [x] **T-1: Defend against AI prompt injection**
  - File: `src/services/parser.ts`
  - Issue: User input directly interpolated into Gemini prompt
  - Fix: Used Gemini `systemInstruction` to separate system prompt from user input; user text sent as separate content part (not interpolated); added prompt injection detection with 10 regex patterns (logged as warnings); validated returned `project_id`/`task_id` exist in provided lists (rejects hallucinated/injected IDs)

- [x] **E-1: Reduce admin proxy account privileges**
  - File: `src/services/odoo.ts`, `src/index.ts`
  - Issue: Admin account likely has broader Odoo permissions than needed
  - Fix: Added comprehensive JSDoc documenting minimum required permissions (READ: project.project, project.task, res.users; CREATE: account.analytic.line, project.task); added startup log warning reminding admins to restrict permissions

## MEDIUM

- [x] **I-1: Redact sensitive data from logs**
  - Files: `src/index.ts`, `src/bot.ts`
  - Issue: Full request body, user emails, and message text logged at `info` level
  - Fix: Hashed all emails in logs via `hashEmail()` (SHA-256 prefix); moved message text to `debug` level; removed full `data`/`cardData` objects from info logs; replaced with minimal fields (`projectId`, `hours`, `date`)

- [x] **S-3: Prevent TEST_USER_EMAIL in production**
  - File: `src/bot.ts`
  - Issue: `TEST_USER_EMAIL` env var overrides email extraction, could be set in production
  - Fix: Added runtime check in `extractTeamsEmail()` that logs error and ignores `TEST_USER_EMAIL` when `NODE_ENV=production`

- [x] **I-2: Sanitize OAuth error page HTML**
  - File: `src/routes/oauth.ts`
  - Issue: Raw `error.message` rendered in HTML response without escaping
  - Fix: Error HTML page already uses generic message; applied `escapeHTML()` to OAuth provider error details in JSON response; success page already escaped (S-2 fix)

- [x] **T-2: Validate Adaptive Card action data**
  - File: `src/bot.ts`
  - Issue: Card submit data (`project_id`, `task_id`, `hours`) used without re-validation
  - Fix: Added `Validator.validateTimesheetData()` check before processing; applied `sanitizeTimesheetInput()` to sanitize all fields; rejects invalid data with error card

- [x] **I-4: Use unique PBKDF2 salt per deployment**
  - File: `src/services/tokenStorage.ts`
  - Issue: Static hardcoded salt `'odoo-bot-salt'` for key derivation
  - Fix: Added `deployment_config` SQLite table; generates random 32-byte salt on first run via `crypto.randomBytes(32)`; salt persists in DB across restarts; key derivation deferred to `initialize()` after salt is loaded

- [x] **D-2: Add size limits to in-memory caches**
  - Files: `src/services/cache.ts`, `src/services/userMapping.ts`, `src/services/responseCache.ts`
  - Issue: No maximum entry limits; memory exhaustion possible
  - Fix: Added `maxSize` parameter to `Cache<T>` (default: 10,000) with LRU eviction using Map insertion order; `userCache` limited to 5,000, `failedLookups` to 1,000; `ResponseCache` already had `maxCacheSize` with eviction

- [x] **D-3: Add timeout to Gemini AI calls**
  - File: `src/services/parser.ts`
  - Issue: No explicit timeout on AI requests
  - Fix: Added 30-second timeout via `Promise.race()` against the Gemini API call; timeout triggers safe fallback response with `confidence: 0`

- [x] **R-1: Strengthen audit trail for admin proxy**
  - File: `src/services/odoo.ts`
  - Issue: Odoo `create_uid` shows admin, not actual user
  - Fix: Prepended `[user@email.com]` to timesheet description in `logTimeAsAdminProxy()` so the actual user is always visible in Odoo's timesheet record

- [x] **R-2: Protect audit log integrity**
  - File: `src/services/audit.ts`
  - Issue: Plaintext JSONL file can be modified
  - Fix: Implemented SHA-256 hash chain; each event includes `prevHash` (hash of previous event) and `hash` (hash of current event); tampering detection via chain verification

- [x] **I-3: Document data sent to Gemini AI**
  - File: `src/services/parser.ts`
  - Issue: Project names, task names, and user messages sent to Google
  - Fix: Added comprehensive DATA PRIVACY NOTICE JSDoc to `parseText()` method documenting exactly what data is sent; recommends enterprise tier and privacy policy documentation

## LOW

- [x] **T-3: Protect offline queue integrity**
  - File: `src/services/resilience.ts`
  - Issue: Plaintext JSON file at `data/offline-queue.json`
  - Fix: Added HMAC-SHA256 integrity check using `TOKEN_ENCRYPTION_KEY` or `BOT_PASSWORD`; queue saved with `{data, hmac}` envelope; load verifies HMAC before accepting; legacy format migrated on next save

- [x] **E-2: Tighten service account mode restrictions**
  - File: `src/config/config.ts`
  - Issue: Only blocked in `NODE_ENV=production`, not `staging` etc.
  - Fix: Changed check to allowlist: service_account mode now only permitted when `NODE_ENV` is `development` or `test`; all other environments (production, staging, etc.) rejected with descriptive error
