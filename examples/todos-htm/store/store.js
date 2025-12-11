import { createStore } from "unistore/full/preact";

const KEY = "@buntime/todos-htm";

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

const storage = {
  get: () => JSON.parse(localStorage.getItem(KEY) || "{}"),
  set: debounce((t) => localStorage.setItem(KEY, JSON.stringify(t)), 500),
};

const getHash = () => {
  const str = (window.location.hash.match(/\w+/g) || [])[0];
  return str !== "completed" && str !== "active" ? "all" : str;
};

export const store = createStore({
  hash: getHash(),
  todos: storage.get(),
});

window.onhashchange = () => store.setState({ hash: getHash() });
store.subscribe((s) => setTimeout(() => storage.set(s.todos)));
