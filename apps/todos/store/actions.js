import { getFiltered } from "./selectors.js";

export const actions = () => ({
  addTodo(state, text = "") {
    const uid = new Date().toJSON().replace(/[^\w]/g, "");
    const todo = { uid, text, completed: false };
    return { ...state, todos: { ...state.todos, [uid]: todo } };
  },

  clearCompletedTodos({ todos }) {
    const remaining = {};
    for (const todo of Object.values(todos)) {
      if (!todo.completed) remaining[todo.uid] = todo;
    }
    return { todos: remaining };
  },

  editTodo(state, { uid, text }) {
    const todo = state.todos[uid];
    if (!todo) return state;
    return { ...state, todos: { ...state.todos, [uid]: { ...todo, text } } };
  },

  removeTodo(state, { uid }) {
    const { [uid]: _, ...rest } = state.todos;
    return { ...state, todos: rest };
  },

  toggleTodo(state, { uid, completed }) {
    const todo = state.todos[uid];
    if (!todo) return state;
    return { ...state, todos: { ...state.todos, [uid]: { ...todo, completed: !completed } } };
  },

  toggleAllTodos(s) {
    const completed = !getFiltered(s).every((t) => t.completed);
    const updatedTodos = {};
    for (const todo of Object.values(s.todos)) {
      updatedTodos[todo.uid] = { ...todo, completed };
    }
    return { todos: updatedTodos };
  },
});
