import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@buntime/shadcn-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { kv } from "~/helpers/kv";
import { Icon } from "./icon";
import { PageHeader } from "./page-header";
import { ScrollArea } from "./scroll-area";

interface QueueStats {
  dlq: number;
  pending: number;
  processing: number;
  total: number;
}

interface DlqMessage {
  attempts: number;
  errorMessage: string | null;
  failedAt: number;
  id: string;
  originalCreatedAt: number;
  originalId: string;
  value: unknown;
}

export function QueueView() {
  const { t } = useTranslation();
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [dlqMessages, setDlqMessages] = useState<DlqMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [messageValue, setMessageValue] = useState('{"type": "test"}');
  const [delay, setDelay] = useState("");
  const [receivedMessages, setReceivedMessages] = useState<unknown[]>([]);
  const [listening, setListening] = useState(false);
  const listenerRef = useRef<{ stop: () => void } | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const result = await kv.queueStats();
      setStats(result);
    } catch (error) {
      console.error("Stats error:", error);
    }
  }, []);

  const loadDlq = useCallback(async () => {
    try {
      const messages = await kv.dlq.list<unknown>({ limit: 20 });
      setDlqMessages(messages);
    } catch (error) {
      console.error("DLQ error:", error);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadDlq();
  }, [loadStats, loadDlq]);

  const handleEnqueue = useCallback(async () => {
    setLoading(true);
    try {
      const value = JSON.parse(messageValue);
      const options = delay ? { delay: Number.parseInt(delay, 10) } : undefined;
      await kv.enqueue(value, options);
      await loadStats();
      setMessageValue('{"type": "test"}');
      setDelay("");
    } catch (error) {
      console.error("Enqueue error:", error);
    } finally {
      setLoading(false);
    }
  }, [messageValue, delay, loadStats]);

  const handleStartListening = useCallback(() => {
    setListening(true);
    listenerRef.current = kv.listenQueue((value: unknown) => {
      setReceivedMessages((prev) => [...prev, value]);
      loadStats();
    });
  }, [loadStats]);

  const handleStopListening = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListening(false);
  }, []);

  const handleRequeue = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        await kv.dlq.requeue(id);
        await loadDlq();
        await loadStats();
      } catch (error) {
        console.error("Requeue error:", error);
      } finally {
        setLoading(false);
      }
    },
    [loadDlq, loadStats],
  );

  const handleDeleteDlq = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        await kv.dlq.delete(id);
        await loadDlq();
        await loadStats();
      } catch (error) {
        console.error("Delete DLQ error:", error);
      } finally {
        setLoading(false);
      }
    },
    [loadDlq, loadStats],
  );

  return (
    <ScrollArea className="h-full">
      <div className="m-4 space-y-4">
        <PageHeader description={t("queue.description")} title={t("queue.title")} />

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("queue.stats.pending")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.pending ?? "-"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("queue.stats.processing")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.processing ?? "-"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("queue.stats.dlq")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.dlq ?? "-"}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>{t("queue.stats.total")}</CardDescription>
              <CardTitle className="text-2xl">{stats?.total ?? "-"}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Tabs defaultValue="enqueue">
          <TabsList>
            <TabsTrigger value="enqueue">
              <Icon className="size-4" icon="lucide:send" />
              {t("queue.tabs.enqueue")}
            </TabsTrigger>
            <TabsTrigger value="listen">
              <Icon className="size-4" icon="lucide:radio" />
              {t("queue.tabs.listen")}
            </TabsTrigger>
            <TabsTrigger value="dlq">
              <Icon className="size-4" icon="lucide:alert-triangle" />
              {t("queue.tabs.dlq")}
            </TabsTrigger>
          </TabsList>

          <TabsContent className="space-y-4" value="enqueue">
            <Card>
              <CardHeader>
                <CardTitle>{t("queue.enqueue.title")}</CardTitle>
                <CardDescription>{t("queue.enqueue.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4">
                  <div className="space-y-2">
                    <Label>{t("queue.enqueue.valueLabel")}</Label>
                    <Input
                      placeholder={t("queue.enqueue.valuePlaceholder")}
                      value={messageValue}
                      onChange={(e) => setMessageValue(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("queue.enqueue.delayLabel")}</Label>
                    <Input
                      placeholder={t("queue.enqueue.delayPlaceholder")}
                      type="number"
                      value={delay}
                      onChange={(e) => setDelay(e.target.value)}
                    />
                  </div>
                  <Button disabled={loading || !messageValue} onClick={handleEnqueue}>
                    {loading ? (
                      <Icon className="size-4 animate-spin" icon="lucide:loader-2" />
                    ) : (
                      <Icon className="size-4" icon="lucide:send" />
                    )}
                    {t("queue.enqueue.send")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="space-y-4" value="listen">
            <Card>
              <CardHeader>
                <CardTitle>{t("queue.listen.title")}</CardTitle>
                <CardDescription>{t("queue.listen.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  {listening ? (
                    <Button variant="destructive" onClick={handleStopListening}>
                      <Icon className="size-4" icon="lucide:square" />
                      {t("queue.listen.stop")}
                    </Button>
                  ) : (
                    <Button onClick={handleStartListening}>
                      <Icon className="size-4" icon="lucide:play" />
                      {t("queue.listen.start")}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setReceivedMessages([])}>
                    <Icon className="size-4" icon="lucide:trash-2" />
                    {t("queue.listen.clear")}
                  </Button>
                </div>

                {listening && (
                  <Badge variant="default">
                    <Icon className="size-3 animate-pulse" icon="lucide:radio" />
                    {t("queue.listen.listening")}
                  </Badge>
                )}

                <div className="space-y-2">
                  <Label>
                    {t("queue.listen.received")} ({receivedMessages.length})
                  </Label>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-4 text-sm">
                    {receivedMessages.length === 0
                      ? t("queue.listen.noMessages")
                      : receivedMessages
                          .map((msg, i) => `${i + 1}. ${JSON.stringify(msg)}`)
                          .join("\n")}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent className="space-y-4" value="dlq">
            <Card>
              <CardHeader>
                <CardTitle>{t("queue.dlq.title")}</CardTitle>
                <CardDescription>{t("queue.dlq.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("queue.dlq.table.id")}</TableHead>
                      <TableHead>{t("queue.dlq.table.value")}</TableHead>
                      <TableHead>{t("queue.dlq.table.attempts")}</TableHead>
                      <TableHead>{t("queue.dlq.table.error")}</TableHead>
                      <TableHead className="w-[120px]">{t("queue.dlq.table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dlqMessages.length === 0 ? (
                      <TableRow>
                        <TableCell className="text-center text-muted-foreground" colSpan={5}>
                          {t("queue.dlq.empty")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      dlqMessages.map((msg) => (
                        <TableRow key={msg.id}>
                          <TableCell>
                            <code className="text-xs">{msg.id.slice(0, 8)}...</code>
                          </TableCell>
                          <TableCell>
                            <pre className="max-w-xs truncate text-xs">
                              {JSON.stringify(msg.value)}
                            </pre>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{msg.attempts}</Badge>
                          </TableCell>
                          <TableCell>
                            <span className="max-w-xs truncate text-xs text-destructive">
                              {msg.errorMessage ?? "-"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => handleRequeue(msg.id)}
                              >
                                <Icon className="size-4" icon="lucide:rotate-ccw" />
                              </Button>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => handleDeleteDlq(msg.id)}
                              >
                                <Icon className="size-4 text-destructive" icon="lucide:trash-2" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
