const filter = (hash, { todos }) => {
  const all = Object.values(todos);
  if (hash === "all") return all;
  return all.filter(hash === "active" ? (t) => !t.completed : (t) => t.completed);
};

export const getAll = (state) => filter("all", state);

export const getIncompleted = (state) => filter("active", state);

export const getCompleted = (state) => filter("completed", state);

export const getFiltered = (state) => filter(state.hash, state);

export const getAllDone = (state) => getFiltered(state).every((t) => t.completed);
