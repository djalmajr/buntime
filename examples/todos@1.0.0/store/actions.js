import { getFiltered } from "./selectors.js";
import { kv } from "./store.js";

export const actions = () => ({
  async addTodo(state, text = "") {
    const uid = crypto.randomUUID();
    const todo = { uid, text, completed: false };
    await kv.set(["todos", uid], todo);
    return { ...state, todos: { ...state.todos, [uid]: todo } };
  },

  async clearCompletedTodos({ todos }) {
    const remaining = {};
    const atomic = kv.atomic();
    for (const todo of Object.values(todos)) {
      if (todo.completed) {
        atomic.delete(["todos", todo.uid]);
      } else {
        remaining[todo.uid] = todo;
      }
    }
    await atomic.commit();
    return { todos: remaining };
  },

  async editTodo(state, { uid, text }) {
    const todo = state.todos[uid];
    if (!todo) return state;
    const updated = { ...todo, text };
    await kv.set(["todos", uid], updated);
    return { ...state, todos: { ...state.todos, [uid]: updated } };
  },

  async removeTodo(state, { uid }) {
    await kv.delete(["todos", uid]);
    const { [uid]: _, ...rest } = state.todos;
    return { ...state, todos: rest };
  },

  async toggleTodo(state, { uid, completed }) {
    const todo = state.todos[uid];
    if (!todo) return state;
    const updated = { ...todo, completed: !completed };
    await kv.set(["todos", uid], updated);
    return { ...state, todos: { ...state.todos, [uid]: updated } };
  },

  async toggleAllTodos(s) {
    const completed = !getFiltered(s).every((t) => t.completed);
    const updatedTodos = {};
    const atomic = kv.atomic();
    for (const todo of Object.values(s.todos)) {
      const updated = { ...todo, completed };
      atomic.set(["todos", todo.uid], updated);
      updatedTodos[todo.uid] = updated;
    }
    await atomic.commit();
    return { todos: updatedTodos };
  },
});
