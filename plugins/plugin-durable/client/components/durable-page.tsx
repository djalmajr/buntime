import { ScrollArea } from "@buntime/shadcn-ui";
import { useCallback, useEffect, useState } from "react";
import { DurableDetail } from "~/components/durable-detail";
import { DurableList } from "~/components/durable-list";
import { api } from "~/utils/api";

interface DurableObject {
  className: string;
  createdAt: number;
  id: string;
  lastActiveAt: number;
}

export function DurablePage() {
  const [objects, setObjects] = useState<DurableObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.durable.index.$get();
      const results = await response.json();
      setObjects(results);
    } catch (error) {
      console.error("List error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    handleRefresh();
  }, [handleRefresh]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedId(null);
  }, []);

  const handleDeleted = useCallback(() => {
    setSelectedId(null);
    handleRefresh();
  }, [handleRefresh]);

  return (
    <ScrollArea className="h-full">
      {selectedId ? (
        <DurableDetail id={selectedId} onBack={handleBack} onDeleted={handleDeleted} />
      ) : (
        <DurableList
          loading={loading}
          objects={objects}
          onRefresh={handleRefresh}
          onSelect={handleSelect}
        />
      )}
    </ScrollArea>
  );
}
