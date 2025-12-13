import { useCallback, useEffect, useMemo, useState } from "react";
import redaxios from "redaxios";
import type { FilterType, Todo } from "~/types";

const api = redaxios.create({ baseURL: "/todos@2/api" });

const getHashFilter = (): FilterType => {
  const str = (window.location.hash.match(/\w+/g) || [])[0];
  return str !== "completed" && str !== "active" ? "all" : str;
};

export function useTodos() {
  const [todos, setTodos] = useState<Record<string, Todo>>({});
  const [filter, setFilter] = useState<FilterType>(getHashFilter);
  const [loading, setLoading] = useState(true);

  // Load todos on mount
  useEffect(() => {
    const loadTodos = async () => {
      try {
        const list: Todo[] = (await api.get("/todos")).data;
        const loaded: Record<string, Todo> = {};
        for (const todo of list) {
          loaded[todo.uid] = todo;
        }
        setTodos(loaded);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    loadTodos();
  }, []);

  // Handle hash changes
  useEffect(() => {
    const handleHashChange = () => setFilter(getHashFilter());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Computed values
  const allTodos = useMemo(() => Object.values(todos), [todos]);

  const filteredTodos = useMemo(() => {
    if (filter === "all") return allTodos;
    if (filter === "active") return allTodos.filter((t) => !t.completed);
    return allTodos.filter((t) => t.completed);
  }, [allTodos, filter]);

  const activeTodos = useMemo(() => allTodos.filter((t) => !t.completed), [allTodos]);
  const completedTodos = useMemo(() => allTodos.filter((t) => t.completed), [allTodos]);
  const allDone = useMemo(
    () => allTodos.length > 0 && allTodos.every((t) => t.completed),
    [allTodos],
  );

  // Actions
  const addTodo = useCallback(async (text: string) => {
    const todo: Todo = (await api.post("/todos", { text })).data;
    setTodos((prev) => ({ ...prev, [todo.uid]: todo }));
  }, []);

  const editTodo = useCallback(async (uid: string, text: string) => {
    const updated: Todo = (await api.put(`/todos/${uid}`, { text })).data;
    setTodos((prev) => ({ ...prev, [uid]: updated }));
  }, []);

  const toggleTodo = useCallback(async (uid: string) => {
    setTodos((prev) => {
      const todo = prev[uid];
      if (!todo) return prev;
      const newCompleted = !todo.completed;
      api.put(`/todos/${uid}`, { completed: newCompleted });
      return { ...prev, [uid]: { ...todo, completed: newCompleted } };
    });
  }, []);

  const removeTodo = useCallback(async (uid: string) => {
    await api.delete(`/todos/${uid}`);
    setTodos((prev) => {
      const { [uid]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const toggleAll = useCallback(async () => {
    const newCompleted = !allDone;
    const updated: Todo[] = (await api.post("/todos/toggle-all", { completed: newCompleted })).data;
    const newTodos: Record<string, Todo> = {};
    for (const todo of updated) {
      newTodos[todo.uid] = todo;
    }
    setTodos(newTodos);
  }, [allDone]);

  const clearCompleted = useCallback(async () => {
    const remaining: Todo[] = (await api.post("/todos/clear-completed")).data;
    const newTodos: Record<string, Todo> = {};
    for (const todo of remaining) {
      newTodos[todo.uid] = todo;
    }
    setTodos(newTodos);
  }, []);

  return {
    // State
    activeTodos,
    allDone,
    allTodos,
    completedTodos,
    filter,
    filteredTodos,
    loading,

    // Actions
    addTodo,
    clearCompleted,
    editTodo,
    removeTodo,
    toggleAll,
    toggleTodo,
  };
}
