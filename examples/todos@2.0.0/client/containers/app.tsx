import { useTodos } from "~/hooks/use-todos";
import pkg from "../../package.json" with { type: "json" };
import { Footer } from "./footer";
import { Header } from "./header";
import { Todo } from "./todo";
import "./app.css";

export function App() {
  const {
    activeTodos,
    allDone,
    allTodos,
    completedTodos,
    filter,
    filteredTodos,
    loading,
    addTodo,
    clearCompleted,
    editTodo,
    removeTodo,
    toggleAll,
    toggleTodo,
  } = useTodos();

  if (loading) {
    return (
      <div className="app__loader">
        <div className="app__loader__spinner" />
      </div>
    );
  }

  return (
    <div className="app__container">
      <section className="app__content">
        <Header
          allDone={allDone}
          isEmpty={!filteredTodos.length}
          onAdd={addTodo}
          onToggleAll={toggleAll}
        />
        <section className="app__todos">
          <ul>
            {filteredTodos.map((todo) => (
              <Todo
                key={todo.uid}
                todo={todo}
                onEdit={editTodo}
                onRemove={removeTodo}
                onToggle={toggleTodo}
              />
            ))}
          </ul>
        </section>
        <Footer
          all={allTodos}
          completed={completedTodos}
          filter={filter}
          incompleted={activeTodos}
          onClearCompleted={clearCompleted}
        />
      </section>
      <footer className="app__info">
        <p>Double-click to edit a todo. v{pkg.version}</p>
        <p>
          Written by <a href="https://user.dev">Djalma Jr.</a>
        </p>
      </footer>
    </div>
  );
}
