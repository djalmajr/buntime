import type { KvKey } from "@buntime/keyval";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@buntime/shadcn-ui";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";
import { Icon } from "./icon";
import { PageHeader } from "./page-header";
import { ScrollArea } from "./scroll-area";

interface WatchEvent {
  eventType: "set" | "delete";
  id: string;
  key: KvKey;
  timestamp: number;
  value: unknown;
  versionstamp: string | null;
}

type OverflowStrategy = "drop-newest" | "drop-oldest";

export function WatchView() {
  const { t } = useTranslation();
  const [watchKey, setWatchKey] = useState("");
  const [prefixMode, setPrefixMode] = useState(false);
  const [overflowStrategy, setOverflowStrategy] = useState<OverflowStrategy>("drop-oldest");
  const [bufferSize, setBufferSize] = useState("100");
  const [isWatching, setIsWatching] = useState(false);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const watcherRef = useRef<{ stop: () => void } | null>(null);

  const handleStartWatch = useCallback(() => {
    if (!watchKey) return;

    const keyParts = watchKey.split("watch.,").map((p) => p.trim());
    const options = {
      bufferSize: bufferSize ? Number.parseInt(bufferSize, 10) : 100,
      overflowStrategy,
      prefix: prefixMode,
    };

    watcherRef.current = kv.watch(
      keyParts,
      (entries) => {
        const newEvents: WatchEvent[] = entries.map((entry) => ({
          eventType: entry.value === null ? "delete" : "set",
          id: crypto.randomUUID(),
          key: entry.key,
          timestamp: Date.now(),
          value: entry.value,
          versionstamp: entry.versionstamp,
        }));

        setEvents((prev) => [...newEvents, ...prev]);
      },
      options,
    );

    setIsWatching(true);
  }, [watchKey, prefixMode, overflowStrategy, bufferSize]);

  const handleStopWatch = useCallback(() => {
    watcherRef.current?.stop();
    watcherRef.current = null;
    setIsWatching(false);
  }, []);

  const handleClearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("watch.description")} title={t("watch.title")} />

        {/* Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>{t("watch.config.title")}</CardTitle>
            <CardDescription>{t("watch.config.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("watch.config.keyLabel")}</Label>
                <Input
                  disabled={isWatching}
                  placeholder={t("watch.config.keyPlaceholder")}
                  value={watchKey}
                  onChange={(e) => setWatchKey(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("watch.config.bufferSizeLabel")}</Label>
                <Input
                  disabled={isWatching}
                  placeholder={t("watch.config.bufferSizePlaceholder")}
                  type="number"
                  value={bufferSize}
                  onChange={(e) => setBufferSize(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  checked={prefixMode}
                  disabled={isWatching}
                  id="prefix-mode"
                  onCheckedChange={(checked) => setPrefixMode(checked === true)}
                />
                <Label className="cursor-pointer" htmlFor="prefix-mode">
                  {t("watch.config.prefixMode")}
                </Label>
              </div>

              <div className="space-y-2">
                <Label>{t("watch.config.overflowStrategyLabel")}</Label>
                <Select
                  disabled={isWatching}
                  value={overflowStrategy}
                  onValueChange={(value) => setOverflowStrategy(value as OverflowStrategy)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="drop-oldest">
                      {t("watch.config.strategies.dropOldest")}
                    </SelectItem>
                    <SelectItem value="drop-newest">
                      {t("watch.config.strategies.dropNewest")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2">
              {isWatching ? (
                <Button variant="destructive" onClick={handleStopWatch}>
                  <Icon className="size-4" icon="lucide:square" />
                  {t("watch.controls.stop")}
                </Button>
              ) : (
                <Button disabled={!watchKey} onClick={handleStartWatch}>
                  <Icon className="size-4" icon="lucide:eye" />
                  {t("watch.controls.start")}
                </Button>
              )}
              <Button variant="outline" onClick={handleClearEvents}>
                <Icon className="size-4" icon="lucide:trash-2" />
                {t("watch.controls.clear")}
              </Button>
            </div>

            {isWatching && (
              <Badge variant="default">
                <Icon className="size-3 animate-pulse" icon="lucide:eye" />
                {t("watch.controls.watching")}
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Events Log */}
        <Card>
          <CardHeader>
            <CardTitle>
              {t("watch.events.title")} ({events.length})
            </CardTitle>
            <CardDescription>{t("watch.events.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">{t("watch.events.table.type")}</TableHead>
                  <TableHead>{t("watch.events.table.key")}</TableHead>
                  <TableHead>{t("watch.events.table.value")}</TableHead>
                  <TableHead>{t("watch.events.table.versionstamp")}</TableHead>
                  <TableHead className="w-[120px]">{t("watch.events.table.timestamp")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.length === 0 ? (
                  <TableRow>
                    <TableCell className="text-center text-muted-foreground" colSpan={5}>
                      {t("watch.events.empty")}
                    </TableCell>
                  </TableRow>
                ) : (
                  events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <Badge variant={event.eventType === "set" ? "default" : "destructive"}>
                          {event.eventType === "set" ? (
                            <Icon className="size-3" icon="lucide:plus" />
                          ) : (
                            <Icon className="size-3" icon="lucide:trash-2" />
                          )}
                          {event.eventType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-muted px-1 text-xs">
                          [{event.key.map((k: unknown) => JSON.stringify(k)).join(", ")}]
                        </code>
                      </TableCell>
                      <TableCell>
                        <pre className="max-w-xs truncate text-xs">
                          {event.value === null ? "null" : JSON.stringify(event.value)}
                        </pre>
                      </TableCell>
                      <TableCell>
                        {event.versionstamp ? (
                          <Badge variant="outline">{event.versionstamp.slice(0, 8)}...</Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </ScrollArea>
  );
}
