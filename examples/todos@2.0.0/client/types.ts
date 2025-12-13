export interface Todo {
  completed: boolean;
  text: string;
  uid: string;
}

export type FilterType = "all" | "active" | "completed";
