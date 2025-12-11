import { Kv } from "@buntime/keyval";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FilterType, Todo } from "~/types";

const kv = new Kv("/_/plugin-keyval");

const generateId = () => new Date().toJSON().replace(/[^\w]/g, "");

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
        const loaded: Record<string, Todo> = {};
        for await (const entry of kv.list<Todo>(["todos"])) {
          if (entry.value) {
            loaded[entry.value.uid] = entry.value;
          }
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
    const uid = generateId();
    const todo: Todo = { uid, text, completed: false };
    await kv.set(["todos", uid], todo);
    setTodos((prev) => ({ ...prev, [uid]: todo }));
  }, []);

  const editTodo = useCallback(async (uid: string, text: string) => {
    setTodos((prev) => {
      const todo = prev[uid];
      if (!todo) return prev;
      const updated = { ...todo, text };
      kv.set(["todos", uid], updated);
      return { ...prev, [uid]: updated };
    });
  }, []);

  const toggleTodo = useCallback(async (uid: string) => {
    setTodos((prev) => {
      const todo = prev[uid];
      if (!todo) return prev;
      const updated = { ...todo, completed: !todo.completed };
      kv.set(["todos", uid], updated);
      return { ...prev, [uid]: updated };
    });
  }, []);

  const removeTodo = useCallback(async (uid: string) => {
    await kv.delete(["todos", uid], { exact: true });
    setTodos((prev) => {
      const { [uid]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const toggleAll = useCallback(async () => {
    const newCompleted = !allDone;
    const atomic = kv.atomic();
    const updated: Record<string, Todo> = {};

    for (const todo of allTodos) {
      const newTodo = { ...todo, completed: newCompleted };
      atomic.set(["todos", todo.uid], newTodo);
      updated[todo.uid] = newTodo;
    }

    await atomic.commit();
    setTodos(updated);
  }, [allTodos, allDone]);

  const clearCompleted = useCallback(async () => {
    const atomic = kv.atomic();
    const remaining: Record<string, Todo> = {};

    for (const todo of allTodos) {
      if (todo.completed) {
        atomic.delete(["todos", todo.uid]);
      } else {
        remaining[todo.uid] = todo;
      }
    }

    await atomic.commit();
    setTodos(remaining);
  }, [allTodos]);

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
