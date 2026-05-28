import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { type CreateTenantResponse, tenantsApi } from "~/lib/api";

export const Route = createFileRoute("/")({
  component: TenantsPage,
});

function TenantsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState("");
  const [host, setHost] = useState("");

  const tenants = useQuery({ queryKey: ["tenants"], queryFn: tenantsApi.list });

  const create = useMutation({
    mutationFn: () => tenantsApi.create({ slug: slug.trim(), host: host.trim() }),
    onSuccess: (res: CreateTenantResponse) => {
      toast.success(`Tenant "${res.tenant.slug}" created`, {
        description: `User ${res.credentials.username} · temp password ${res.credentials.temporaryPassword}`,
        duration: 15000,
      });
      setOpen(false);
      setSlug("");
      setHost("");
      qc.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (s: string) => tenantsApi.remove(s),
    onSuccess: () => {
      toast.success("Tenant removed");
      qc.invalidateQueries({ queryKey: ["tenants"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mx-auto max-w-4xl p-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tenants</h1>
          <p className="text-muted-foreground text-sm">
            Provision a tenant: Keycloak realm + Cloudflare hostname + registry.
          </p>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus /> New tenant
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New tenant</DialogTitle>
              <DialogDescription>
                The slug becomes the Keycloak realm name. The host is published on the tunnel.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  placeholder="tenant-3"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="host">Host</Label>
                <Input
                  id="host"
                  placeholder="tenant-3.djalmajr.dev"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                disabled={!slug.trim() || !host.trim() || create.isPending}
                onClick={() => create.mutate()}
              >
                {create.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </header>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Realm</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {tenants.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  No tenants yet.
                </TableCell>
              </TableRow>
            )}
            {tenants.data?.map((t) => (
              <TableRow key={t.host}>
                <TableCell className="font-medium">{t.slug}</TableCell>
                <TableCell>{t.host}</TableCell>
                <TableCell>{t.realm}</TableCell>
                <TableCell>{t.status}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(t.slug)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
