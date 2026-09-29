import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CAMPAIGN_STATUS_META, type CampaignStatus, STAGE_META, type Stage } from "@/lib/vocab";

export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  const m = STAGE_META[stage];
  return <Badge className={cn("border-transparent", m.className, className)}>{m.label}</Badge>;
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const m = CAMPAIGN_STATUS_META[status];
  return <Badge className={cn("border-transparent", m.className)}>{m.label}</Badge>;
}
