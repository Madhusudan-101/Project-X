# Y Combinator Application: Tech Stack & AI Tools

**Question:** What tech stack are you using, or planning to use, to build this product? Include AI models and AI coding tools you use.

---

### **Current Tech Stack**

We are building a highly responsive, modern web application using a decoupled architecture with a Python-based backend and a TypeScript/React frontend. Our current choices prioritize developer velocity, type safety, and performance.

#### **Frontend (Client-Side)**
*   **Core:** React 19, TypeScript, and Vite.
*   **Framework & Routing:** TanStack Start and TanStack Router for full-stack React framework capabilities and type-safe routing.
*   **State Management & Data Fetching:** Zustand for lightweight global state and TanStack Query (React Query) for robust asynchronous state management and caching.
*   **Styling & UI:** TailwindCSS v4 for utility-first styling, combined with Radix UI primitives for accessible, headless components, and Framer Motion for fluid animations.
*   **Forms & Validation:** React Hook Form paired with Zod for strict schema validation.
*   **Visualizations & Components:** Recharts for data visualization and Embla for carousels.

#### **Backend (Server-Side)**
*   **Core:** Python 3.
*   **API Framework:** FastAPI, served via Uvicorn, for high-performance, asynchronous REST APIs.
*   **Data Validation:** Pydantic for robust data parsing and serialization.
*   **Database & Backend Services:** Supabase (PostgreSQL) acts as our primary database and BaaS platform, with schema evolution managed through custom SQL migrations.
*   **External Integrations:** `httpx` for fast async HTTP communications.

### **AI Models**
*   **Product AI Features:** We integrate **Google Gemini** (via the `google-genai` Python SDK) directly into our backend to power the core generative AI capabilities of our application.

### **AI Coding Tools**
*   **IDE & Autonomous Agents:** We use **Antigravity IDE** (developed by Google DeepMind) for our development workflow.
*   **Primary Coding Model:** We rely heavily on **Gemini 3.1 Pro** acting as our autonomous AI software engineer and pair programmer to rapidly scaffold features, write robust tests, and execute complex cross-stack refactoring.
