# KETracker2: Logic Errors and Technical Debt Resolution Report

This report details the specific logic errors, architectural inconsistencies, and technical debt identified during the audit of the **KETracker2** monorepo, along with the implemented fixes to ensure deployment readiness.

---

## 1. Weekly Plans Date Serialization & Timezone Drift

### **Issue**
The `weekly-plans` and `weekly-plans/progress` endpoints were manually parsing date strings and using `new Date().toISOString()` for database queries.
- **The Risk**: Creating a `Date` object from a string like `"2026-07-20"` without a time component defaults to midnight UTC. Depending on the server's local timezone, calling `.toISOString()` or local date methods could shift the date by one day (e.g., resulting in `"2026-07-19"`).
- **The Inconsistency**: The database schema expects a strict `YYYY-MM-DD` string for the `week_start` column.

### **Fix**
I refactored the date handling to use a "safe extraction" pattern:
1. **Validation**: Integrated `@workspace/api-zod` to validate the query parameters.
2. **Serialization**: Implemented a robust extraction method: `ws.toISOString().split("T")[0]`.
3. **Consistency**: Added a fallback check `ws instanceof Date ? ... : String(ws)` to ensure that regardless of how the parser returns the object, the database always receives a valid ISO date string.

---

## 2. Shared Type Contract Bypass

### **Issue**
While most of the API used the generated Zod contract layer (`@workspace/api-zod`), the `weeklyPlans.ts` route was an outlier.
- **The Problem**: It used manual `Number(req.body.productId)` and `String(req.body.weekStart)` casting. This bypassed the runtime validation provided by the OpenAPI specification.
- **The Impact**: If the frontend sent a malformed payload, the backend would attempt a database operation that might fail with a cryptic Drizzle/Postgres error rather than a clear `400 Bad Request` with validation details.

### **Fix**
- Replaced manual parsing with `CreateWeeklyPlanBody.parse(req.body)` and `ListWeeklyPlansQueryParams.parse(...)`.
- This aligned the `weekly-plans` logic with the rest of the application's "Contract-First" architecture.

---

## 3. Weekly Plan UI State Lock-in

### **Issue**
In the `WeeklyPlan.tsx` frontend page, the input field for "Planned Quantity" had a logic flaw in its `value` and `disabled` props.
- **The Logic**: `value={hasPlan && !value ? String(planned) : value}`.
- **The Bug**: If a user wanted to change a plan back to `0` or keep it at its current value to "re-save," the `!value` check (where `0` or `""` are falsy) would cause the input to revert its display to the previously saved `planned` value. Additionally, the Save button was disabled if `!value` was true, making it impossible to explicitly save a `0` quantity.

### **Fix**
- Changed the state check to look for `undefined` instead of falsy values:
  ```tsx
  value={value !== undefined ? value : (hasPlan ? String(planned) : "")}
  ```
- Updated the Save button's disabled state to `disabled={createPlan.isPending || value === undefined}`.
- This allows the user to explicitly type `0` or clear the field, and correctly enables the Save button only when an actual change has been typed.

---

## 4. Step 99 (Ready Parts) Synchronization

### **Issue**
The system uses a special "Step 99" to track finished products. While creating a product triggered an `upsertStep99` call, updating a product (e.g., changing its name) did not.
- **The Risk**: If a product's name was updated, the Step 99 entry in the `steps` table would remain associated with the product ID but might not reflect metadata changes if the `upsert` logic relied on them, or it simply missed a synchronization checkpoint.

### **Fix**
- Added `await upsertStep99(product.id)` to the `PUT /api/products/:id` route.
- This ensures that every time a product is modified, its "Ready Parts" step is verified and synchronized.

---

## 5. Build System & Environment Constraints

### **Issue**
Several "Replit-isms" in the build configuration prevented the app from building in a standard Linux environment.
- **Electron Leakage**: The API server's `app.ts` was trying to access `process.resourcesPath`, a property that only exists in Electron, causing TypeScript to fail during the build.
- **Strict Env Vars**: The `mockup-sandbox` Vite config threw hard errors if `PORT` or `BASE_PATH` were missing during a static build, which is unnecessary for the build phase.

### **Fix**
- **Type Casting**: Cast `process` to `any` for the Electron-specific check to satisfy the compiler while maintaining compatibility for the Electron port.
- **Build Defaults**: Provided sensible defaults (`3000`, `/`) for environment variables during the Vite build process to allow the CI/CD pipeline to complete without requiring a full runtime environment.

---

## Summary of Status
The KETracker2 project is now **fully synchronized** between its OpenAPI specification, database schema, and frontend implementation. All critical logic paths for production tracking and weekly planning have been verified.
