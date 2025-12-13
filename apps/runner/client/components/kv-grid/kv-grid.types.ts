import type { KvEntry, KvKey } from "@buntime/keyval";

export interface KvGridProps {
  entries: KvEntry[];
  loading?: boolean;
  onDelete?: (key: KvKey) => Promise<void>;
  onDeleteMultiple?: (keys: KvKey[]) => Promise<void>;
  onEdit?: (key: KvKey, value: unknown) => Promise<void>;
  onRefresh?: () => void;
}

export type KvGridColumnId = "actions" | "key" | "value" | "versionstamp";

export interface KvGridColumn {
  id: KvGridColumnId;
  title: string;
  width: number;
}
