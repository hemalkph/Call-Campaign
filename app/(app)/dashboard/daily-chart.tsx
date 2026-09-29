"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtDay } from "@/lib/time";

const config = {
  reached: { label: "Reached", color: "var(--series-1)" },
  notReached: { label: "Not reached", color: "var(--series-2)" },
} satisfies ChartConfig;

type Day = { day: string; reached: number; notReached: number };
const short = (day: string) => fmtDay(day).replace(/ \d{4}$/, ""); // "29 Sep"

export function DailyChart({ data }: { data: Day[] }) {
  if (data.every((d) => !d.reached && !d.notReached))
    return <p className="py-10 text-center text-sm text-muted-foreground">No calls in the last 14 days yet.</p>;
  return (
    <>
      <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-label="Calls per day, last 14 days">
        <BarChart data={data} margin={{ left: -16, right: 4 }}>
          <CartesianGrid vertical={false} strokeOpacity={0.4} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} tickFormatter={short} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <ChartTooltip cursor={{ fillOpacity: 0.3 }} content={<ChartTooltipContent labelFormatter={(d) => fmtDay(String(d))} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {/* 2px surface-coloured stroke separates the stacked segments; only the top gets rounded ends. */}
          <Bar dataKey="reached" stackId="calls" fill="var(--color-reached)" maxBarSize={24} stroke="var(--background)" strokeWidth={2} />
          <Bar dataKey="notReached" stackId="calls" fill="var(--color-notReached)" maxBarSize={24} radius={[4, 4, 0, 0]} stroke="var(--background)" strokeWidth={2} />
        </BarChart>
      </ChartContainer>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead>
            <tr className="text-muted-foreground">
              <th className="font-normal">Day</th>
              <th className="font-normal">Reached</th>
              <th className="font-normal">Not reached</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{fmtDay(d.day)}</td>
                <td>{d.reached}</td>
                <td>{d.notReached}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
