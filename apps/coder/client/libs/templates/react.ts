import type { ProjectTemplate } from "./types";

const INDEX_CONTENT = `import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(<App />);
`;

const APP_CONTENT = `import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-8">
      <div className="rounded-2xl bg-white/90 p-8 shadow-2xl backdrop-blur">
        <h1 className="mb-6 text-center text-3xl font-bold text-gray-800">
          React App
        </h1>
        <p className="mb-4 text-center text-gray-600">
          Edit the code and click "Run" to see changes
        </p>
        <div className="flex flex-col items-center gap-4">
          <span className="text-5xl font-bold text-indigo-600">{count}</span>
          <button
            className="rounded-lg bg-indigo-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-indigo-700"
            onClick={() => setCount(c => c + 1)}
          >
            Increment
          </button>
        </div>
      </div>
    </div>
  );
}
`;

export const reactTemplate: ProjectTemplate = {
  dependencies: [
    { name: "react", version: "^19.0.0" },
    { name: "react-dom", version: "^19.0.0" },
  ],
  description: "React app with TypeScript and a counter example",
  files: [
    { content: INDEX_CONTENT, path: "/index.tsx" },
    { content: APP_CONTENT, path: "/App.tsx" },
  ],
  icon: "lucide:atom",
  id: "react",
  name: "React",
};
