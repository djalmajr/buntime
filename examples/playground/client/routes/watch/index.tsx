import type { KvKey } from "@buntime/keyval";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "~/components/icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { kv } from "~/helpers/kv";
import { PageHeader } from "~/routes/-components/page-header";

interface WatchEvent {
  eventType: "set" | "delete";
  id: string;
  key: KvKey;
  timestamp: number;
  value: unknown;
  versionstamp: string | null;
}

type OverflowStrategy = "drop-newest" | "drop-oldest";

function WatchPage() {
  const { t } = useTranslation("watch");
  const [watchKey, setWatchKey] = useState("");
  const [prefixMode, setPrefixMode] = useState(false);
  const [overflowStrategy, setOverflowStrategy] = useState<OverflowStrategy>("drop-oldest");
  const [bufferSize, setBufferSize] = useState("100");
  const [isWatching, setIsWatching] = useState(false);
  const [events, setEvents] = useState<WatchEvent[]>([]);
  const watcherRef = useRef<{ stop: () => void } | null>(null);

  const handleStartWatch = useCallback(() => {
    if (!watchKey) return;

    const keyParts = watchKey.split(",").map((p) => p.trim());
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
    <div className="space-y-6">
      <PageHeader description={t("description")} title={t("title")} />

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t("config.title")}</CardTitle>
          <CardDescription>{t("config.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("config.keyLabel")}</Label>
              <Input
                disabled={isWatching}
                placeholder={t("config.keyPlaceholder")}
                value={watchKey}
                onChange={(e) => setWatchKey(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>{t("config.bufferSizeLabel")}</Label>
              <Input
                disabled={isWatching}
                placeholder={t("config.bufferSizePlaceholder")}
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
                {t("config.prefixMode")}
              </Label>
            </div>

            <div className="space-y-2">
              <Label>{t("config.overflowStrategyLabel")}</Label>
              <Select
                disabled={isWatching}
                value={overflowStrategy}
                onValueChange={(value) => setOverflowStrategy(value as OverflowStrategy)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="drop-oldest">{t("config.strategies.dropOldest")}</SelectItem>
                  <SelectItem value="drop-newest">{t("config.strategies.dropNewest")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            {isWatching ? (
              <Button variant="destructive" onClick={handleStopWatch}>
                <Icon className="size-4" icon="lucide:square" />
                {t("controls.stop")}
              </Button>
            ) : (
              <Button disabled={!watchKey} onClick={handleStartWatch}>
                <Icon className="size-4" icon="lucide:eye" />
                {t("controls.start")}
              </Button>
            )}
            <Button variant="outline" onClick={handleClearEvents}>
              <Icon className="size-4" icon="lucide:trash-2" />
              {t("controls.clear")}
            </Button>
          </div>

          {isWatching && (
            <Badge variant="default">
              <Icon className="size-3 animate-pulse" icon="lucide:eye" />
              {t("controls.watching")}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Events Log */}
      <Card>
        <CardHeader>
          <CardTitle>
            {t("events.title")} ({events.length})
          </CardTitle>
          <CardDescription>{t("events.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">{t("events.table.type")}</TableHead>
                <TableHead>{t("events.table.key")}</TableHead>
                <TableHead>{t("events.table.value")}</TableHead>
                <TableHead>{t("events.table.versionstamp")}</TableHead>
                <TableHead className="w-[120px]">{t("events.table.timestamp")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell className="text-center text-muted-foreground" colSpan={5}>
                    {t("events.empty")}
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
                        [{event.key.map((k) => JSON.stringify(k)).join(", ")}]
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
  );
}

export const Route = createFileRoute("/watch/")({
  component: WatchPage,
});
