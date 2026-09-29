"use client";

import { DndContext, type DragEndEvent, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import { GripVertical, MoveRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { StageBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { OUTCOME_LABEL, type Outcome, STAGE_META, STAGES, type Stage } from "@/lib/vocab";
import { setContactStage } from "../contacts/actions";

type CardData = { id: string; name: string; phone: string; school: string; caller: string; lastOutcome: Outcome | null; stage: Stage };

export function Board({ campaignId, counts: initialCounts, cards: initialCards }: { campaignId: string; counts: Record<Stage, number>; cards: CardData[] }) {
  const [cards, setCards] = useState(initialCards);
  const [counts, setCounts] = useState(initialCounts);
  const [confirm, setConfirm] = useState<{ card: CardData; to: Stage }>();
  const [announce, setAnnounce] = useState("");
  // Touch needs a short press so the board can still be scrolled with a finger.
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));

  function request(card: CardData, to: Stage) {
    if (card.stage === to) return;
    if (to === "enrolled") setConfirm({ card, to });
    else move(card, to);
  }

  async function move(card: CardData, to: Stage) {
    const from = card.stage;
    const apply = (a: Stage, b: Stage) => {
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: b } : c)));
      setCounts((n) => ({ ...n, [a]: n[a] - 1, [b]: n[b] + 1 }));
    };
    apply(from, to); // optimistic
    setAnnounce(`${card.name} moved to ${STAGE_META[to].label}.`);
    try {
      const res = await setContactStage({ id: card.id, stage: to });
      if (!res.ok) throw new Error(res.error);
    } catch (e) {
      apply(to, from); // roll back
      setAnnounce(`Couldn't move ${card.name}.`);
      toast.error(e instanceof Error && e.message !== "Failed to fetch" ? e.message : "Couldn't save — the card was moved back.");
    }
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const card = cards.find((c) => c.id === active.id);
    if (card && over) request(card, over.id as Stage);
  }

  return (
    <>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0" role="list" aria-label="Pipeline stages">
          {STAGES.map((stage) => (
            <Column key={stage} stage={stage} count={counts[stage]} cards={cards.filter((c) => c.stage === stage)} campaignId={campaignId} onMove={request} />
          ))}
        </div>
      </DndContext>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {confirm?.card.name} as enrolled?</AlertDialogTitle>
            <AlertDialogDescription>Only do this once their payment has been received.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm && move(confirm.card, confirm.to)}>Yes, enrolled</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Column({ stage, count, cards, campaignId, onMove }: { stage: Stage; count: number; cards: CardData[]; campaignId: string; onMove: (c: CardData, to: Stage) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const more = count - cards.length;
  return (
    <section
      ref={setNodeRef}
      role="listitem"
      aria-label={`${STAGE_META[stage].label}, ${count} contacts`}
      className={cn("flex w-72 shrink-0 snap-start flex-col rounded-xl border bg-muted/40 p-2 transition-colors", isOver && "bg-muted ring-2 ring-ring/50")}
    >
      <header className="flex items-center justify-between px-1 pb-2">
        <StageBadge stage={stage} />
        <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
      </header>
      <ul className="flex max-h-[calc(100svh-14rem)] min-h-24 flex-col gap-2 overflow-y-auto">
        {cards.map((c) => (
          <PipelineCard key={c.id} card={c} onMove={onMove} />
        ))}
      </ul>
      {more > 0 && (
        <Link href={`/contacts?campaign=${campaignId}&stage=${stage}`} className="mt-2 px-1 text-sm text-muted-foreground hover:underline">
          +{more} more in the contacts list
        </Link>
      )}
    </section>
  );
}

function PipelineCard({ card, onMove }: { card: CardData; onMove: (c: CardData, to: Stage) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: card.id });
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("rounded-lg border bg-background p-2 text-sm shadow-xs", isDragging && "relative z-10 shadow-lg")}
    >
      <div className="flex items-start gap-1">
        <button
          type="button"
          className="mt-0.5 cursor-grab touch-none rounded text-muted-foreground active:cursor-grabbing"
          aria-label={`Drag ${card.name}`}
          {...listeners}
          {...attributes}
          tabIndex={-1} // keyboard users use the Move menu instead
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{card.name}</p>
          <p className="truncate text-xs text-muted-foreground tabular-nums">
            {card.phone}
            {card.caller && ` · ${card.caller}`}
          </p>
          {card.lastOutcome && <p className="text-xs text-muted-foreground">Last: {OUTCOME_LABEL[card.lastOutcome]}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Move ${card.name}`}>
              <MoveRight aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="font-normal text-muted-foreground">Move to</DropdownMenuLabel>
            {STAGES.filter((s) => s !== card.stage).map((s) => (
              <DropdownMenuItem key={s} onSelect={() => onMove(card, s)}>
                {STAGE_META[s].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
