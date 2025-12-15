import { createStore } from "unistore/full/preact";
import { Kv } from "./kv.js";

const kv = new Kv("/api/keyval");

const getHash = () => {
  const str = (window.location.hash.match(/\w+/g) || [])[0];
  return str !== "completed" && str !== "active" ? "all" : str;
};

export const store = createStore({
  hash: getHash(),
  loading: true,
  todos: {},
});

// Load todos from KV on startup
async function loadTodos() {
  try {
    const entries = await kv.list(["todos"]);
    const todos = {};
    for (const entry of entries) {
      if (entry.value) {
        todos[entry.value.uid] = entry.value;
      }
    }
    store.setState({ loading: false, todos });
  } catch (error) {
    console.error("Failed to load todos:", error);
    store.setState({ loading: false });
  }
}

loadTodos();

window.onhashchange = () => store.setState({ hash: getHash() });

// Export kv for use in actions
export { kv };
