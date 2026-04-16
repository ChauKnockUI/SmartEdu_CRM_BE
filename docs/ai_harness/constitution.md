# CONSTITUTION (Core Directives & System Boundaries)

These are the non-negotiable Hard Rules for all Agents operating within the SmartEdu CRM repository. Violations are strictly prohibited.

## 1. System Resilience (Resilience-First Design)
- **The "Backend Cannot Die" Theorem:** It is strictly forbidden to use `await` on external Microservices (especially the Python AI Scoring API) without a surrounding `try/catch` block.
- If the Python Model fails due to environment errors (Pip/Conda), Timeout, or Internal Errors, the Agent MUST implement a **Graceful Fallback** mechanism. Node.js must continue executing, save data to the Database without breaking the data flow, and return an HTTP 200/201 response to the Frontend rather than crashing.

## 2. Clean Architecture
- Codebase must strictly follow a 3-tier structure:
  1. `Controllers`: Solely responsible for parsing payload, extracting DTOs, validating basic constraints, and returning formatted HTTP responses. Absolutely NO Prisma logic is allowed here.
  2. `Services`: The core of Business Logic (e.g., condition checks, AI orchestration, data transformations).
  3. `Repositories`: The ONLY layer allowed to communicate with the Database via Prisma ORM.

## 3. Database Integrity & Transactions
- For multi-table operations (e.g., Converting a Lead to a Student, Creating a User Account linked to a Student), the Agent **MUST use `prisma.$transaction()`**. Partial data insertions are never allowed. In case of an error, the entire transaction must roll back cleanly.

## 4. Security & Standardized Responses
- Deleting data must be done via Soft Delete or schema-level `Cascade Delete`. Do not leave orphaned rows.
- All API JSON responses must strictly adhere to this format: `{ success: boolean, message?: string, data?: any }`.
