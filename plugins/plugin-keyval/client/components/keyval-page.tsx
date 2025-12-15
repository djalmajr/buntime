import { useFragmentUrl } from "~/utils/use-fragment-url";
import { AtomicView } from "./atomic-view";
import { EntriesView } from "./entries-view";
import { MetricsView } from "./metrics-view";
import { OverviewView } from "./overview-view";
import { QueueView } from "./queue-view";
import { SearchView } from "./search-view";
import { WatchView } from "./watch-view";

export function KeyvalPage() {
  const { path } = useFragmentUrl();

  const segment = path.split("/")[0] || "";

  switch (segment) {
    case "entries":
      return <EntriesView />;
    case "queue":
      return <QueueView />;
    case "search":
      return <SearchView />;
    case "watch":
      return <WatchView />;
    case "atomic":
      return <AtomicView />;
    case "metrics":
      return <MetricsView />;
    default:
      return <OverviewView />;
  }
}
