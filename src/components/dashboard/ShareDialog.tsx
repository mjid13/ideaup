"use client";

import { useEffect, useState } from "react";
import { useAppTranslations } from "@/components/i18n/use-app-translations";
import { Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Project } from "@/types";

type AccessMode = "read" | "write";

interface ShareEntry {
  userId: string;
  email: string;
  accessMode: AccessMode;
}

const ACCESS_LABELS: Record<AccessMode, string> = {
  read: "Can view",
  write: "Can edit",
};

export function ShareDialog({ project }: { project: Project }) {
  const t = useAppTranslations();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareEntry[] | null>(null);
  const [email, setEmail] = useState("");
  const [accessMode, setAccessMode] = useState<AccessMode>("read");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(`/api/projects/${project.id}/shares`, { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { shares?: ShareEntry[] }) => {
        if (active) setShares(body.shares ?? []);
      });
    return () => {
      active = false;
    };
  }, [open, project.id]);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, accessMode }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not share this project.");
      setShares((prev) => [...(prev ?? []).filter((s) => s.userId !== body.userId), { userId: body.userId, email: body.email, accessMode: body.accessMode }]);
      setEmail("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(userId: string) {
    setShares((prev) => (prev ?? []).filter((s) => s.userId !== userId));
    await fetch(`/api/projects/${project.id}/shares/${userId}`, { method: "DELETE" });
  }

  if (project.viewerAccess !== "owner") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Share2 /> {t("Share project")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Share this project")}</DialogTitle>
          <DialogDescription>
            {t("Invite someone who already has an IdeaUp account. They'll see this project in their own list.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {shares !== null && shares.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("No one else has access yet.")}</p>
          )}
          {(shares ?? []).map((share) => (
            <div key={share.userId} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-foreground">{share.email}</p>
                <Badge variant="secondary">{t(ACCESS_LABELS[share.accessMode])}</Badge>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => revoke(share.userId)} aria-label={t("Remove")}>
                <X />
              </Button>
            </div>
          ))}
        </div>

        <form onSubmit={invite} className="space-y-2 border-t border-border pt-3">
          <Input
            type="email"
            required
            placeholder={t("Email address")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <div className="flex gap-2">
            <Select value={accessMode} onValueChange={(value) => setAccessMode(value as AccessMode)}>
              <SelectTrigger className="flex-1">
                <SelectValue>{(value: AccessMode) => t(ACCESS_LABELS[value])}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">{t("Can view")}</SelectItem>
                <SelectItem value="write">{t("Can edit")}</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={busy || !email}>
              {t("Invite")}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
