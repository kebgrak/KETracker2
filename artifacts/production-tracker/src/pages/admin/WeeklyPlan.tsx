import { useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProducts,
  useListWeeklyPlans,
  useCreateWeeklyPlan,
  useDeleteWeeklyPlan,
  useGetWeeklyProgress,
  type WeeklyPlan,
  type WeeklyProgress,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  Upload,
  Download,
  Trash2,
  Save,
  Target,
  CheckCircle2,
  PackageOpen,
  Loader2,
  CalendarIcon,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { exportToXlsx, importFromFile } from "@/lib/xlsx-utils";

// ── week helpers ──────────────────────────────────────────────────────────

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getWeekRange(monday: Date) {
  const start = new Date(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  return { start: formatDate(start), end: formatDate(end) };
}

function addWeeks(d: Date, weeks: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + weeks * 7);
  return result;
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function formatCW(date: Date): string {
  return `CW${getISOWeekNumber(date)}`;
}

// ── Excel import helper ─────────────────────────────────────────────────────

interface ExcelRow {
  "Product Name"?: string;
  "Planned Quantity"?: string | number;
}

async function parseExcelFile(file: File): Promise<ExcelRow[]> {
  const rows = await importFromFile(file);
  return rows as ExcelRow[];
}

export default function WeeklyPlan() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const today = useMemo(() => new Date(), []);
  const [currentWeekMonday, setCurrentWeekMonday] = useState<Date>(getMondayOfWeek(today));
  const weekKey = formatDate(currentWeekMonday);
  const { start, end } = getWeekRange(currentWeekMonday);

  const prevWeekMonday = useMemo(() => addWeeks(currentWeekMonday, -1), [currentWeekMonday]);
  const prevWeekKey = formatDate(prevWeekMonday);
  const prevWeekRange = getWeekRange(prevWeekMonday);

  const products = useListProducts();
  const plans = useListWeeklyPlans({ weekStart: weekKey });
  const progress = useGetWeeklyProgress({ weekStart: weekKey });
  const prevProgress = useGetWeeklyProgress({ weekStart: prevWeekKey });
  const createPlan = useCreateWeeklyPlan();
  const deletePlan = useDeleteWeeklyPlan();

  const [pendingValues, setPendingValues] = useState<Record<number, string>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const progressMap = useMemo(() => {
    const map = new Map<number, WeeklyProgress>();
    if (progress.data) {
      for (const p of progress.data) {
        map.set(p.productId, p);
      }
    }
    return map;
  }, [progress.data]);

  const planMap = useMemo(() => {
    const map = new Map<number, WeeklyPlan>();
    if (plans.data) {
      for (const p of plans.data) {
        map.set(p.productId, p);
      }
    }
    return map;
  }, [plans.data]);

  const chartData = useMemo(() => {
    if (!progress.data) return [];
    return progress.data
      .filter((p) => p.plannedQuantity > 0)
      .map((p) => ({
        name: p.productName,
        Planned: p.plannedQuantity,
        Completed: p.completedQuantity,
        Remaining: p.remainingQuantity,
        pct: p.percentageComplete,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [progress.data]);

  const comparisonData = useMemo(() => {
    const prevMap = new Map<number, number>();
    for (const p of prevProgress.data ?? []) {
      prevMap.set(p.productId, p.completedQuantity);
    }
    const currMap = new Map<number, { name: string; completed: number }>();
    for (const p of progress.data ?? []) {
      currMap.set(p.productId, { name: p.productName, completed: p.completedQuantity });
    }
    // Union of all products appearing in either week
    const allIds = new Set([...prevMap.keys(), ...currMap.keys()]);
    return Array.from(allIds)
      .map((id) => {
        const prev = prevMap.get(id) ?? 0;
        const curr = currMap.get(id)?.completed ?? 0;
        const name = currMap.get(id)?.name ?? (prevProgress.data?.find((p) => p.productId === id)?.productName ?? "");
        const delta = curr - prev;
        const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : null;
        return { id, name, prev, curr, delta, deltaPct };
      })
      .filter((r) => r.prev > 0 || r.curr > 0)
      .sort((a, b) => b.curr - a.curr);
  }, [progress.data, prevProgress.data]);

  function handleSave(productId: number) {
    const raw = pendingValues[productId];
    const qty = raw ? parseInt(raw, 10) : 0;
    if (Number.isNaN(qty) || qty < 0) {
      toast({ title: "Invalid quantity", description: "Please enter a valid positive number.", variant: "destructive" });
      return;
    }

    createPlan.mutate(
      { data: { productId, weekStart: weekKey, plannedQuantity: qty } },
      {
        onSuccess: () => {
          setPendingValues((prev) => {
            const next = { ...prev };
            delete next[productId];
            return next;
          });
          queryClient.invalidateQueries({ queryKey: ["listWeeklyPlans"] });
          queryClient.invalidateQueries({ queryKey: ["getWeeklyProgress"] });
          toast({ title: "Plan saved", description: "Weekly plan updated successfully." });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to save plan.", variant: "destructive" });
        },
      },
    );
  }

  function handleDelete(planId: number) {
    deletePlan.mutate(
      { id: planId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["listWeeklyPlans"] });
          queryClient.invalidateQueries({ queryKey: ["getWeeklyProgress"] });
          toast({ title: "Plan removed", description: "Weekly plan deleted successfully." });
        },
      },
    );
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    try {
      const rows = await parseExcelFile(file);
      let imported = 0;
      let skipped = 0;

      const productList = products.data ?? [];
      const productByName = new Map(productList.map((p) => [p.name.trim().toLowerCase(), p]));

      for (const row of rows) {
        const name = String(row["Product Name"] ?? "").trim();
        const qty = Number(row["Planned Quantity"] ?? 0);
        if (!name || Number.isNaN(qty) || qty <= 0) {
          skipped++;
          continue;
        }
        const product = productByName.get(name.toLowerCase());
        if (!product) {
          skipped++;
          continue;
        }

        await createPlan.mutateAsync({
          data: {
            productId: product.id,
            weekStart: weekKey,
            plannedQuantity: Math.round(qty),
          },
        });
        imported++;
      }

      queryClient.invalidateQueries({ queryKey: ["listWeeklyPlans"] });
      queryClient.invalidateQueries({ queryKey: ["getWeeklyProgress"] });
      toast({
        title: "Import complete",
        description: `${imported} plan(s) imported, ${skipped} skipped.`,
      });
    } catch (err) {
      toast({ title: "Import failed", description: String(err), variant: "destructive" });
    } finally {
      setIsImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleExportExcel() {
    const rows = (progress.data ?? []).map((p) => ({
      "Product Name": p.productName,
      "Planned (pcs)": p.plannedQuantity,
      "Completed (pcs)": p.completedQuantity,
      "Remaining (pcs)": p.remainingQuantity,
      "Progress (%)": p.percentageComplete,
    }));

    const filename = `weekly-plan-${start}.xlsx`;
    await exportToXlsx(
      [{ name: "Weekly Plan", rows, colWidths: [32, 14, 16, 15, 13] }],
      filename
    );
  }

  const isLoading = products.isLoading || progress.isLoading || plans.isLoading;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Weekly Production Plan</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set weekly targets per product and track progress against step 99 reports.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekMonday((d) => addWeeks(d, -1))}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="min-w-44 h-auto py-1.5 px-3 flex flex-col items-center gap-0"
              >
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                  {formatCW(currentWeekMonday)}
                </span>
                <span className="text-xs text-muted-foreground font-normal">
                  {start} → {end}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={currentWeekMonday}
                onSelect={(date) => {
                  if (date) {
                    setCurrentWeekMonday(getMondayOfWeek(date));
                    setCalendarOpen(false);
                  }
                }}
                captionLayout="dropdown"
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekMonday((d) => addWeeks(d, 1))}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentWeekMonday(getMondayOfWeek(new Date()))}
          >
            This Week
          </Button>
        </div>
      </div>

      {/* Import + summary */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={isImporting}
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-1.5" />
            )}
            Import from Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportExcel}
            disabled={!progress.data || progress.data.length === 0}
          >
            <Download className="w-4 h-4 mr-1.5" />
            Export to Excel
          </Button>
          <span className="text-xs text-muted-foreground">
            Expected columns: Product Name, Planned Quantity
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              Planned:
            </span>
            <span className="font-bold">
              {progress.data?.reduce((s, p) => s + p.plannedQuantity, 0) ?? 0}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-muted-foreground">Completed:</span>
            <span className="font-bold">
              {progress.data?.reduce((s, p) => s + p.completedQuantity, 0) ?? 0}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <PackageOpen className="w-4 h-4 text-amber-500" />
            <span className="text-muted-foreground">Remaining:</span>
            <span className="font-bold">
              {progress.data?.reduce((s, p) => s + p.remainingQuantity, 0) ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-card border border-border rounded-sm p-4 mb-6">
          <div className="text-sm font-semibold mb-3">Weekly Progress</div>
          <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
            {chartData.map((entry) => {
              const pct = Math.min(100, entry.pct);
              const overPct = entry.pct > 100 ? entry.pct - 100 : 0;
              return (
                <div key={entry.name} className="flex items-center gap-3">
                  <div className="w-28 text-xs truncate text-right" title={entry.name}>
                    {entry.name}
                  </div>
                  <div className="flex-1 h-5 bg-muted rounded-sm relative overflow-hidden">
                    {/* Completed bar */}
                    <div
                      className="absolute top-0 left-0 h-full rounded-sm transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor:
                          entry.pct >= 100
                            ? "hsl(142, 71%, 45%)"
                            : "hsl(var(--primary))",
                      }}
                    />
                    {/* Over-completion bar */}
                    {overPct > 0 && (
                      <div
                        className="absolute top-0 h-full rounded-sm transition-all opacity-60"
                        style={{
                          left: `${100 - overPct}%`,
                          width: `${overPct}%`,
                          backgroundColor: "hsl(142, 71%, 35%)",
                        }}
                      />
                    )}
                    {/* Label inside bar */}
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white mix-blend-difference">
                      {entry.pct}%
                    </span>
                  </div>
                  <div className="w-24 text-xs text-muted-foreground tabular-nums">
                    {entry.Completed} / {entry.Planned}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-muted rounded-sm animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Product</TableHead>
                <TableHead className="w-32">Planned</TableHead>
                <TableHead className="w-32">Completed</TableHead>
                <TableHead className="w-32">Remaining</TableHead>
                <TableHead className="w-40">Progress</TableHead>
                <TableHead className="w-44">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(products.data ?? []).map((product) => {
                const p = progressMap.get(product.id);
                const plan = planMap.get(product.id);
                const hasPlan = !!plan;
                const value = pendingValues[product.id] ?? "";
                const pct = p?.percentageComplete ?? 0;
                const planned = p?.plannedQuantity ?? 0;
                const completed = p?.completedQuantity ?? 0;
                const remaining = p?.remainingQuantity ?? 0;

                return (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          className="w-24 h-8 text-sm"
                          value={value !== undefined ? value : (hasPlan ? String(planned) : "")}
                          onChange={(e) =>
                            setPendingValues((prev) => ({
                              ...prev,
                              [product.id]: e.target.value,
                            }))
                          }
                          placeholder="0"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-7 h-7"
                          onClick={() => handleSave(product.id)}
                          disabled={createPlan.isPending || value === undefined}
                        >
                          <Save className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {completed}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {remaining}
                    </TableCell>
                    <TableCell>
                      {planned > 0 ? (
                        <div className="w-full">
                          <div className="flex items-center justify-between mb-1">
                            <Badge
                              variant={pct >= 100 ? "default" : "secondary"}
                              className="text-xs font-mono"
                            >
                              {pct}%
                            </Badge>
                          </div>
                          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, pct)}%`,
                                backgroundColor:
                                  pct >= 100
                                    ? "hsl(142, 71%, 45%)"
                                    : pct >= 50
                                    ? "hsl(var(--primary))"
                                    : "hsl(38, 92%, 50%)",
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">No plan</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {plan && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(plan.id)}
                          disabled={deletePlan.isPending}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Remove plan
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Week-over-week comparison */}
      {comparisonData.length > 0 && (
        <div className="bg-card border border-border rounded-sm p-4 mt-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Week-over-Week Comparison</div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted-foreground/30" />
                {formatCW(prevWeekMonday)} (prev)
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-primary/70" />
                {formatCW(currentWeekMonday)} (this week)
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-medium text-muted-foreground pb-2 pr-4">Product</th>
                  <th className="text-right font-medium text-muted-foreground pb-2 px-4 w-32">Prev Week</th>
                  <th className="text-right font-medium text-muted-foreground pb-2 px-4 w-32">This Week</th>
                  <th className="text-right font-medium text-muted-foreground pb-2 pl-4 w-32">Change</th>
                  <th className="w-40 pb-2 pl-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {comparisonData.map((row) => {
                  const isUp = row.delta > 0;
                  const isDown = row.delta < 0;
                  const maxVal = Math.max(...comparisonData.map((r) => Math.max(r.prev, r.curr)), 1);
                  return (
                    <tr key={row.id} className="group">
                      <td className="py-2 pr-4 font-medium truncate max-w-[180px]" title={row.name}>
                        {row.name}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-muted-foreground">
                        {row.prev}
                      </td>
                      <td className="py-2 px-4 text-right font-mono font-medium">
                        {row.curr}
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <span className={`inline-flex items-center gap-1 font-mono text-xs font-medium ${
                          isUp ? "text-emerald-600" : isDown ? "text-red-500" : "text-muted-foreground"
                        }`}>
                          {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : isDown ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                          {isUp ? "+" : ""}{row.delta}
                          {row.deltaPct !== null && (
                            <span className="opacity-70">({isUp ? "+" : ""}{row.deltaPct}%)</span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pl-4">
                        <div className="flex items-center gap-1 h-4">
                          <div className="relative h-3 bg-muted rounded-sm flex-1 overflow-hidden">
                            <div
                              className="absolute top-0 left-0 h-full rounded-sm bg-muted-foreground/30 transition-all"
                              style={{ width: `${(row.prev / maxVal) * 100}%` }}
                            />
                          </div>
                          <div className="relative h-3 bg-muted rounded-sm flex-1 overflow-hidden">
                            <div
                              className={`absolute top-0 left-0 h-full rounded-sm transition-all ${
                                isUp ? "bg-emerald-500/70" : isDown ? "bg-red-400/70" : "bg-primary/70"
                              }`}
                              style={{ width: `${(row.curr / maxVal) * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border">
                <tr>
                  <td className="pt-2 pr-4 text-xs font-semibold text-muted-foreground">Total</td>
                  <td className="pt-2 px-4 text-right font-mono text-sm text-muted-foreground">
                    {comparisonData.reduce((s, r) => s + r.prev, 0)}
                  </td>
                  <td className="pt-2 px-4 text-right font-mono text-sm font-semibold">
                    {comparisonData.reduce((s, r) => s + r.curr, 0)}
                  </td>
                  <td className="pt-2 pl-4 text-right">
                    {(() => {
                      const totalDelta = comparisonData.reduce((s, r) => s + r.delta, 0);
                      const totalPrev = comparisonData.reduce((s, r) => s + r.prev, 0);
                      const totalDeltaPct = totalPrev > 0 ? Math.round((totalDelta / totalPrev) * 100) : null;
                      const isUp = totalDelta > 0;
                      const isDown = totalDelta < 0;
                      return (
                        <span className={`inline-flex items-center gap-1 font-mono text-xs font-semibold ${
                          isUp ? "text-emerald-600" : isDown ? "text-red-500" : "text-muted-foreground"
                        }`}>
                          {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : isDown ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                          {isUp ? "+" : ""}{totalDelta}
                          {totalDeltaPct !== null && <span className="opacity-70">({isUp ? "+" : ""}{totalDeltaPct}%)</span>}
                        </span>
                      );
                    })()}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
