# SKILLS (Technical Capabilities & Best Practices)

This is the Toolbox available to the Agents. Agents are expected to utilize these techniques actively and proficiently.

## 1. Code Editor & Viewer Mastery
- Always use `view_file` to thoroughly read database structures (e.g., `schema.prisma`) before defining Types/DTOs in the Node.js backend.
- Strictly use `multi_replace_file_content` block-replacement techniques rather than overwriting full files to preserve existing comments, documentation, and the application's current stability.

## 2. Advanced Prisma ORM Techniques
- Fluently use nested `include` operators to achieve relational joins smoothly (e.g., Lead Joins User [selecting only ID, omit password] Joins Course Joins AI_Score).
- Implement performant asynchronous patterns utilizing `Promise.all()` to execute non-blocking queries concurrently (e.g., firing `count` and `findMany` side-by-side to accelerate pagination).
- Mutate Data Transfer Objects (DTOs) at the service layer to normalize payloads, delivering perfectly flat objects that the React/Next.js Frontend can consume seamlessly.

## 3. Node.js & Distributed Systems Integration
- Apply strict Pydantic-like validation at the Backend layer. Cast and format raw payload data precisely (e.g., flooring fractional values to strict Integers) before passing POST Requests over the network to the FastAPI Python Server.
- Build "Fire-and-Forget" background tasks using trailing asynchronous chains (e.g., `triggerAI().catch(err => console.error(err))`) to ensure Heavy AI processing never blocks the Express.js Event Loop.
