"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md rounded-lg border p-8 text-center">
      <h1 className="mb-2 text-lg font-semibold">Something went wrong</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        This page couldn&apos;t load — usually a dropped connection. Nothing you saved was lost.
      </p>
      <Button onClick={() => retry()}>
        <RotateCcw aria-hidden /> Try again
      </Button>
    </div>
  );
}
