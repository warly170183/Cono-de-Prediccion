# Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. All persistent collections live strictly under `/users/{userId}/...` and require authenticated, email-verified ownership (`request.auth != null && request.auth.token.email_verified == true && request.auth.uid == userId`).
2. PII (`email`, `displayName`) is isolated inside `/users/{userId}/private/{docId}` (`docId == 'info'`) with no public or cross-user `get`/`list` access.
3. Every write enforces strict schema keys (`hasAll` + `hasOnly`), string length bounds, ID regex (`^[a-zA-Z0-9_-]+$`), numeric positivity/sanity checks, ownerId immutability, and server timestamp integrity (`request.time`).
4. Global catch-all default-deny rule (`match /{document=**} { allow read, write: if false; }`) sits at the top of `match /databases/{database}/documents`.

## 2. Adversarial Payloads ("Dirty Dozen")
1. **Unauthenticated read/write** to `/users/u1/predictions/btc_2026-11-21` -> `PERMISSION_DENIED`.
2. **Unverified email** (`email_verified: false`) attempting create/update on `/users/u1/tradePresets/p1` -> `PERMISSION_DENIED`.
3. **Cross-tenant read/list** (`auth.uid == 'u2'` reading `/users/u1/predictions`) -> `PERMISSION_DENIED`.
4. **Identity spoofing** (`auth.uid == 'u1'`, `ownerId: 'u2'` inside `/users/u1/predictions/p1`) -> `PERMISSION_DENIED`.
5. **Shadow / Ghost field injection** (`isAdmin: true` or `role: 'admin'` in `UserPrivateInfo`) -> `PERMISSION_DENIED` via `hasOnly()`.
6. **Document ID poisoning** (`predictionId` > 128 chars or containing invalid symbols `$%`) -> `PERMISSION_DENIED` via `isValidId()`.
7. **Timestamp forgery** (`createdAt: '2020-01-01'` instead of `request.time`) -> `PERMISSION_DENIED`.
8. **Type mismatch / Value poisoning** (`spot: "90000"` string or `slPct: -5` negative) -> `PERMISSION_DENIED`.
9. **String exhaustion** (`note` > 80 chars or `regimeVol` > 32 chars) -> `PERMISSION_DENIED`.
10. **Asset enum bypass** (`asset: 'doge'` instead of `btc|eth|sol`) -> `PERMISSION_DENIED`.
11. **Missing required fields** on `PredictionSnapshot` create -> `PERMISSION_DENIED`.
12. **PII blanket access** (`auth.uid == 'u2'` reading `/users/u1/private/info`) -> `PERMISSION_DENIED`.
13. **Terminal state bypass on `TradeOption`** attempting to mutate `status` from `'tp_hit'` back to `'open'` or alter immutable `entryPrice` -> `PERMISSION_DENIED`.
14. **Invalid trade option parameters** (`slPct: 0` or `status: 'admin_override'`) on `/users/u1/tradeOptions/op1` -> `PERMISSION_DENIED`.

