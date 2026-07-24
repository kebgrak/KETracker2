# 🎯 Consolidated Master Audit Report: KETracker2 Refactoring Plan

## 📊 Executive Summary
This consolidated report architecture merges static code analysis and optimized backend/frontend refactoring requirements for the **KETracker2** monorepo. The goal is to eliminate severe security vulnerabilities (CORS and metadata leaks), enforce strict database data integrity (Step 99 constraints and transaction blocks), optimize query execution, and correct client-side timezone drift.

---

## 🛑 1. P0: Critical Security Flaws & Data Integrity (Fix Immediately)

### [P0-CORS] Permissive Cross-Origin Resource Sharing Vulnerability
* **File:** `artifacts/api-server/src/app.ts`
* **Problem:** Setting `cors({ origin: true, credentials: true })` echoes back any dynamic client origin header. Combined with active session credentials, this allows malicious third-party websites (`evil.com`) to execute unauthorized actions on behalf of logged-in administration sessions.
* **Action for Replit Agent:** Implement a secure, deterministic validation fallback system using an explicit whitelist array:
```ts
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS?.split(",") ?? [];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error("Blocked by CORS security filters"));
    }
  },
  credentials: true,
}));
```

### [P0-STEP99] Missing Database Uniqueness Constraint for Step 99
* **File:** `artifacts/api-server/src/routes/reports.ts`
* **Problem:** The API checks for existing step 99 reports before insertion, but there is no database-level uniqueness constraint on `(product_id, report_date, step_id)`. Concurrent submissions or accidental double-clicks bypass the check and create duplicate reports.
* **Action for Replit Agent:** Create a migration adding a unique constraint or partial unique index in the PostgreSQL schema via Drizzle:
```ts
unique("product_date_step_unique").on(reports.productId, reports.reportDate, reports.stepId)
```

### [P0-PARTIAL] Partial Writes when Splitting Time Across Substeps
* **File:** `artifacts/production-tracker/src/pages/OperatorEntry.tsx`
* **Problem:** Component uses `Promise.all([... createReport.mutateAsync(...)])` without transactional semantics. If one step insert fails, earlier inserts remain in the database, leaving an inconsistent partial state.
* **Action for Replit Agent:** Move the multi-report processing block from the frontend directly into a single atomic backend endpoint wrapped inside a database transaction (`db.transaction(async (tx) => { ... })`).

---

## ⚠️ 2. P1: High Priority Defect Remediation

### [P1-LEAK] Administrative Metadata Leaks via Public Information Reads
* **Files:** `artifacts/api-server/src/routes/operators.ts`, `artifacts/api-server/src/routes/products.ts`
* **Problem:** Unauthenticated public endpoints (`publicRouter.get("/operators")`) perform complete database table selects without column projection. This exposes every column—including administrative `email` addresses, `isAdmin` roles, and `isModerator` status flags—to any guest visitor.
* **Action for Replit Agent:** Refactor public SQL selects using explicit Drizzle projections to return only non-privileged properties:
```ts
db.select({ 
  id: operatorsTable.id, 
  name: operatorsTable.name, 
  employeeId: operatorsTable.employeeId, 
  isLineleader: operatorsTable.isLineleader 
})
.from(operatorsTable).orderBy(operatorsTable.name)
```

### [P1-VALIDATE] Invalid Foreign-Key Insert Behavior
* **File:** `artifacts/api-server/src/routes/reports.ts`
* **Problem:** `POST /api/reports` validates the data shape via Zod, but does not verify that `operatorId`, `productId`, or `stepId` actually exist in the database before attempting insertion, throwing unhandled raw DB errors.
* **Action for Replit Agent:** Update the backend schema validation logic or controller path to perform explicit existence checks, or gracefully catch PostgreSQL foreign key violations (`23503`) to return a clean API error.

### [P1-RACE] Non-Atomic Upsert Sequences inside Weekly Plans
* **File:** `artifacts/api-server/src/routes/weeklyPlans.ts`
* **Problem:** Writing updates via disjointed `delete` and `insert` statements introduces transaction gaps. Concurrent payloads can bypass existing database constraints, creating duplicate rows under production concurrency.
* **Action for Replit Agent:** Leverage database-level atomic persistence directly by using Drizzle's modern `.onConflictDoUpdate()` routine:
```ts
const [inserted] = await db.insert(weeklyPlansTable)
  .values({ productId, weekStart, plannedQuantity })
  .onConflictDoUpdate({
    target: [weeklyPlansTable.productId, weeklyPlansTable.weekStart],
    set: { plannedQuantity, updatedAt: new Date() },
  })
  .returning();
```

### [P1-N1] Dynamic SQL N+1 Query Aggregation Chains
* **File:** `artifacts/api-server/src/routes/summary.ts`
* **Problem:** Generating operator and product statistics relies on sub-queries nested deep inside asynchronous iterative loops (`Promise.all`), increasing system overhead exponentially as records expand ($O(N)$ queries).
* **Action for Replit Agent:** Consolidate data calculation into flat relational requests. Use a single efficient query execution routine backed by native database `GROUP BY` grouping statements and relational aggregate functions (`count`, `sum`).

---

## 🧹 3. P2 & P3: Code Quality, Standardization & Timezones

### [P2-TIMEZONE] Client System Timezone Drift Correction
* **Files:** `artifacts/production-tracker/src/pages/OperatorEntry.tsx`, `artifacts/production-tracker/src/pages/admin/WeeklyPlan.tsx`
* **Problem:** Frontend components parse system schedules using browser-local date constructors (`getFullYear()`, `getMonth()`). Submitting entries near midnight boundaries causes index misalignment relative to the backend server's strict UTC interpretation.
* **Action for Replit Agent:** Standardize calendar evaluation across components by forcing isolated `getUTC*` attributes to lock user interaction cleanly with backend database time.

### [P2-ERRORS] Express Exception Catch Wrappers and Schema Concealment
* **Files:** All API Server endpoints
* **Problem:** Request processing lacks proper error handling boundaries. Unhandled Zod validation faults generate full execution stack rejections, mapping internal schema metadata directly into standard `500` server responses.
* **Action for Replit Agent:** Deploy a centralized async routing supervisor (`lib/asyncHandler.ts`). Capture underlying application faults cleanly and format payload validation anomalies to abort safely with structured `400 Bad Request` notifications.

### [P2-HANG] Defensive Throttling in Step99 Initialization
* **File:** `artifacts/api-server/src/lib/step99.ts`
* **Problem:** `initAllStep99()` runs `upsertStep99` for every product in parallel. If the product count is very large, it spawns too many simultaneous DB queries, threatening to crash or hang the database connection pool.
* **Action for Replit Agent:** Batch the operations or use a sequential array loop/limited concurrency utility (like `p-limit`) to execute updates in safe, metered blocks.

---

## 🔒 4. Global Server Hardening Checklist
* **[P2-COOKIES] Session Cookie Hardening:** Force strict cookie tracking definitions across runtime profiles, declaring `sameSite: "strict"` limits and setting the production `secure: true` attribute for non-Electron environments.
* **[P3-CAPS] Network Payload Boundaries:** Bind preventive input size limits to express server JSON array ingest pipelines (`app.use(express.json({ limit: "100kb" }))`).
* **[P3-HEADERS] Injected Security Headers:** Protect application rendering channels against clickjacking and spoofing by executing **Helmet** defensive middle-tier engines.
* **[P3-BOOT] Fail-Fast Setup Verification:** Abort backend launch procedures immediately if initialization validation passes fail to locate a cryptographically secure `SESSION_SECRET` variable.

---

## 📋 Replit Agent Ordered Execution Blueprint

1. **Phase 1 (Global Shared Tools & Guards):** Deploy standard system wrappers under `lib/asyncHandler.ts`, timezone utilities in `lib/dateUtils.ts`, and apply unified Helmet/CORS controls onto `app.ts`.
2. **Phase 2 (Information Leak Block & Relations):** Restructure database access profiles across `operators.ts` and `products.ts` public reads to projection-filter schema attributes, and add foreign-key checks to `reports.ts`.
3. **Phase 3 (Data Integrity & Transactions):** Implement the atomic transactional backend endpoint for multi-step creation to replace the unsafe frontend loop in `OperatorEntry.tsx`. Add the database unique constraint for Step 99.
4. **Phase 4 (Atomic Persistence & UI Timing):** Revamp data persistence structures inside `weeklyPlans.ts` with atomic updates via `.onConflictDoUpdate()`. Update client-side UI files to use UTC methods.
5. **Phase 5 (Performance and Throttling Optimizations):** Re-engineer performance-tracking endpoints inside `summary.ts` using structured aggregate grouping workflows. Refactor `initAllStep99()` to run sequentially or via controlled batch queues.
