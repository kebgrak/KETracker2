import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListOperators,
  useListProducts,
  useListSteps,
  useListReports,
  getListStepsQueryKey,
  useCreateReportsBatch,
  getListReportsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Package,
  ShieldAlert,
  Timer,
  User,
  Users,
  XCircle,
} from "lucide-react";

// ── Searchable combobox ────────────────────────────────────────────────────────

interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
}

function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  disabled = false,
  loading = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (open && triggerRef.current) {
      setWidth(triggerRef.current.offsetWidth);
    }
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? (
            <span className="text-muted-foreground">Loading...</span>
          ) : selected ? (
            <span className="flex items-center gap-2 truncate">
              <span>{selected.label}</span>
              {selected.sublabel && (
                <span className="text-muted-foreground text-xs">
                  — {selected.sublabel}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        style={{ width: width ?? "var(--radix-popover-trigger-width)" }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={`${opt.label} ${opt.sublabel ?? ""}`}
                  onSelect={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <span className="flex items-center gap-2 w-full">
                    <span className="font-medium">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="text-muted-foreground text-xs">
                        — {opt.sublabel}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Form schema (step selection managed separately) ───────────────────────────

const schema = z.object({
  operatorId: z.string().min(1, "Select an operator"),
  productId: z.string().min(1, "Select a product"),
  timeWorkedMinutes: z.string().optional(),
  operatorCount: z.string().optional(),
  quantityCompleted: z
    .string()
    .min(1, "Enter quantity")
    .refine(
      (v) => Number.isInteger(Number(v)) && Number(v) > 0,
      "Must be a positive integer"
    ),
  reportDate: z.string().min(1, "Select a date"),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ── Main component ─────────────────────────────────────────────────────────────

export default function OperatorEntry() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedStepIds, setSelectedStepIds] = useState<number[]>([]);
  const [stepError, setStepError] = useState<string | null>(null);

  // Employee ID verification
  const [employeeIdInput, setEmployeeIdInput] = useState("");
  const [idVerified, setIdVerified] = useState(false);

  const operators = useListOperators();
  const products = useListProducts();
  const steps = useListSteps(selectedProductId!, {
    query: {
      enabled: !!selectedProductId,
      queryKey: getListStepsQueryKey(selectedProductId!),
    },
  });
  const createReportsBatch = useCreateReportsBatch();

  const today = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  })();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      operatorId: "",
      productId: "",
      timeWorkedMinutes: "",
      operatorCount: "",
      quantityCompleted: "",
      reportDate: today,
      notes: "",
    },
  });

  const watchedOperatorId = form.watch("operatorId");
  const watchedProductId = form.watch("productId");
  const watchedTime = form.watch("timeWorkedMinutes");
  const watchedQty = form.watch("quantityCompleted");
  const watchedOpCount = form.watch("operatorCount");

  // Reset ID verification and step selection when operator changes
  useEffect(() => {
    setEmployeeIdInput("");
    setIdVerified(false);
    setSelectedStepIds([]);
    setStepError(null);
  }, [watchedOperatorId]);

  // Reset product/steps when product changes
  useEffect(() => {
    if (watchedProductId) {
      setSelectedProductId(Number(watchedProductId));
      setSelectedStepIds([]);
      setStepError(null);
    } else {
      setSelectedProductId(null);
      setSelectedStepIds([]);
    }
  }, [watchedProductId]);

  // Derived: selected operator object
  const selectedOperator = operators.data?.find(
    (op) => String(op.id) === watchedOperatorId
  );

  // Lineleader mode: any lineleader operator
  const isLineleaderMode = !!selectedOperator?.isLineleader;

  // Pre-fetch existing reports for the selected product when in lineleader mode,
  // so we can catch step-99 duplicates before even hitting the server.
  const watchedReportDate = form.watch("reportDate");
  const existingProductReports = useListReports(
    { productId: selectedProductId! },
    { query: { enabled: isLineleaderMode && !!selectedProductId } } as Parameters<typeof useListReports>[1],
  );

  // Default time to 450 min when a lineleader is selected; clear it when switching away
  useEffect(() => {
    if (isLineleaderMode) {
      const current = form.getValues("timeWorkedMinutes");
      if (!current || current === "") {
        form.setValue("timeWorkedMinutes", "450");
      }
    } else {
      const current = form.getValues("timeWorkedMinutes");
      if (current === "450") {
        form.setValue("timeWorkedMinutes", "");
      }
    }
  }, [isLineleaderMode]);

  // Auto-select step 99 when a lineleader is selected and steps are loaded
  useEffect(() => {
    if (!isLineleaderMode) return;
    const step99 = allStepGroups.find((g) => g.stepNumber === 99);
    if (!step99) return;
    const ids = step99.isSubStepGroup
      ? step99.substeps.map((s) => s.id)
      : [step99.members[0].id];
    setSelectedStepIds(ids);
    setStepError(null);
  }, [isLineleaderMode, steps.data]);

  // Employee ID match check
  const idMatches =
    selectedOperator &&
    employeeIdInput.trim().toLowerCase() ===
      selectedOperator.employeeId.toLowerCase();

  // Auto-verify when it matches
  useEffect(() => {
    if (idMatches && !idVerified) setIdVerified(true);
    if (!idMatches && idVerified) setIdVerified(false);
  }, [idMatches]);

  // Operator options for combobox
  const operatorOptions: ComboboxOption[] =
    operators.data?.map((op) => ({
      value: String(op.id),
      label: op.name,
    })) ?? [];

  // Product options for combobox
  const productOptions: ComboboxOption[] =
    products.data?.map((p) => ({
      value: String(p.id),
      label: p.name,
    })) ?? [];

  // Group steps by stepNumber — all steps (before role filter)
  const allStepGroups = (() => {
    if (!steps.data) return [];
    const map = new Map<number, typeof steps.data>();
    for (const s of steps.data) {
      const group = map.get(s.stepNumber) ?? [];
      group.push(s);
      map.set(s.stepNumber, group);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepNumber, members]) => {
        const sorted = members.sort((a, b) =>
          (a.subStepLabel ?? "").localeCompare(b.subStepLabel ?? "")
        );
        const parent = sorted.find((m) => !m.subStepLabel) ?? null;
        const substeps = sorted.filter((m) => !!m.subStepLabel);
        const isSubStepGroup = substeps.length > 0;
        const substepTotal = substeps.reduce(
          (s, m) => s + Number(m.standardTimeMinutes),
          0
        );
        return { stepNumber, parent, substeps, members: sorted, isSubStepGroup, substepTotal };
      });
  })();

  // Role-based filtering: lineleaders see only step 99; everyone else sees all except step 99
  const stepGroups = (() => {
    if (selectedOperator?.isLineleader) {
      return allStepGroups.filter((g) => g.stepNumber === 99);
    }
    return allStepGroups.filter((g) => g.stepNumber !== 99);
  })();

  function handleGroupToggle(group: (typeof allStepGroups)[number]) {
    setStepError(null);
    if (!group.isSubStepGroup) {
      const singleId = group.members[0].id;
      setSelectedStepIds((prev) => (prev[0] === singleId ? [] : [singleId]));
    } else {
      const substepIds = group.substeps.map((s) => s.id);
      setSelectedStepIds((prev) => {
        const allSelected =
          substepIds.length > 0 && substepIds.every((id) => prev.includes(id));
        return allSelected ? [] : substepIds;
      });
    }
  }

  function handleSubstepToggle(substepId: number, group: (typeof allStepGroups)[number]) {
    setStepError(null);
    const groupSubstepIds = new Set(group.substeps.map((s) => s.id));
    setSelectedStepIds((prev) => {
      // If current selection contains IDs outside this group, switch to just this substep
      const hasOutside = prev.some((id) => !groupSubstepIds.has(id));
      if (hasOutside) return [substepId];
      // Toggle within this group
      if (prev.includes(substepId)) return prev.filter((id) => id !== substepId);
      return [...prev, substepId];
    });
  }

  const selectedSteps =
    steps.data?.filter((s) => selectedStepIds.includes(s.id)) ?? [];
  const totalStandardTime = selectedSteps.reduce(
    (sum, s) => sum + Number(s.standardTimeMinutes),
    0
  );

  async function onSubmit(values: FormValues) {
    if (!idVerified) {
      toast({
        title: "ID verification required",
        description: "Please enter your Employee ID to continue.",
        variant: "destructive",
      });
      return;
    }
    if (selectedStepIds.length === 0) {
      setStepError("Select at least one step");
      return;
    }

    if (!values.timeWorkedMinutes || Number(values.timeWorkedMinutes) <= 0) {
      form.setError("timeWorkedMinutes", { message: "Enter time worked" });
      return;
    }
    const totalTime = Number(values.timeWorkedMinutes);

    let opCount: number | null = null;
    if (isLineleaderMode) {
      const count = Number(values.operatorCount);
      if (!values.operatorCount || count <= 0) {
        form.setError("operatorCount", { message: "Enter a valid number of operators" });
        return;
      }
      opCount = count;
    }

    const qty = Number(values.quantityCompleted);

    // Determine if this is a substep group submission
    const selectedGroup = allStepGroups.find((g) =>
      g.isSubStepGroup
        ? g.substeps.some((s) => selectedStepIds.includes(s.id))
        : g.members.some((s) => selectedStepIds.includes(s.id))
    );

    type ReportEntry = { stepId: number; time: number };
    let reportsToCreate: ReportEntry[];

    if (selectedGroup?.isSubStepGroup) {
      // Only create reports for the substeps actually selected (may be a subset)
      const selectedSubsteps = selectedGroup.substeps.filter((s) =>
        selectedStepIds.includes(s.id)
      );
      const selectedSubstepTotal = selectedSubsteps.reduce(
        (s, m) => s + Number(m.standardTimeMinutes),
        0
      );
      if (selectedSubsteps.length === 1) {
        // Single substep — full time goes to it
        reportsToCreate = [{ stepId: selectedSubsteps[0].id, time: totalTime }];
      } else {
        // Multiple substeps — distribute proportionally among selected ones
        reportsToCreate = selectedSubsteps.map((s) => ({
          stepId: s.id,
          time:
            selectedSubstepTotal > 0
              ? totalTime * (Number(s.standardTimeMinutes) / selectedSubstepTotal)
              : totalTime / selectedSubsteps.length,
        }));
      }
    } else {
      reportsToCreate = [{ stepId: selectedStepIds[0], time: totalTime }];
    }

    // ── Step 99 duplicate pre-flight (client-side) ──────────────────────────
    if (isLineleaderMode && Array.isArray(existingProductReports.data)) {
      const reportsArr = existingProductReports.data as Array<{ reportDate?: string; step?: { stepNumber?: number } }>;
      const duplicate = reportsArr.find(
        (r) => r.reportDate === values.reportDate && r.step?.stepNumber === 99,
      );
      if (duplicate) {
        const d = new Date(values.reportDate + "T00:00:00");
        const displayDate = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        const productName = products.data?.find((p) => String(p.id) === values.productId)?.name ?? values.productId;
        toast({
          title: "Duplicate entry",
          description: `For ${displayDate} for product "${productName}" a Step 99 report has already been entered`,
          variant: "destructive",
        });
        return;
      }
    }

    try {
      await createReportsBatch.mutateAsync({
        data: {
          entries: reportsToCreate.map(({ stepId, time }) => ({
            operatorId: Number(values.operatorId),
            productId: Number(values.productId),
            stepId,
            timeWorkedMinutes: time,
            quantityCompleted: qty,
            operatorCount: opCount,
            reportDate: values.reportDate,
            notes: values.notes || undefined,
          })),
        },
      });
      const count = reportsToCreate.length;
      toast({
        title: "Work report submitted",
        description:
          count > 1
            ? `Time split proportionally across ${count} sub-steps.`
            : "Your entry has been recorded.",
      });
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      setSelectedStepIds([]);
      form.reset({
        ...form.getValues(),
        timeWorkedMinutes: isLineleaderMode ? "450" : "",
        operatorCount: "",
        quantityCompleted: "",
        notes: "",
      });
    } catch (err) {
      // Surface the server's 409 duplicate-entry message verbatim
      const apiErr = err as { status?: number; data?: { error?: string } };
      if (apiErr?.status === 409 && apiErr?.data?.error) {
        toast({
          title: "Duplicate entry",
          description: apiErr.data.error,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Submission failed",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    }
  }

  // Whether the lower sections should be accessible
  const canProceed = idVerified;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary" />
          Work Entry
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Record your production activity for today
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* ── Identification ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <User className="w-4 h-4" />
                Identification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Operator combobox */}
              <FormField
                control={form.control}
                name="operatorId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Operator</FormLabel>
                    <FormControl>
                      <Combobox
                        options={operatorOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select operator..."
                        searchPlaceholder="Type name or employee ID..."
                        loading={operators.isLoading}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Employee ID verification */}
              {watchedOperatorId && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Confirm Employee ID
                  </label>
                  <div className="relative">
                    <Input
                      value={employeeIdInput}
                      onChange={(e) => setEmployeeIdInput(e.target.value)}
                      placeholder="Enter your employee ID..."
                      className={
                        employeeIdInput.length > 0
                          ? idMatches
                            ? "border-green-500 pr-9 focus-visible:ring-green-500"
                            : "border-destructive pr-9 focus-visible:ring-destructive"
                          : "pr-9"
                      }
                    />
                    {employeeIdInput.length > 0 && (
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                        {idMatches ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-destructive" />
                        )}
                      </span>
                    )}
                  </div>
                  {employeeIdInput.length > 0 && !idMatches && (
                    <p className="text-xs text-destructive flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" />
                      ID does not match — check and try again
                    </p>
                  )}
                  {idVerified && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      Identity confirmed
                    </p>
                  )}
                </div>
              )}

              {/* Date */}
              <FormField
                control={form.control}
                name="reportDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        data-testid="input-report-date"
                        disabled={!canProceed}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* ── Product & Step ── */}
          <Card className={!canProceed ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Package className="w-4 h-4" />
                Product & Step
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Product combobox */}
              <FormField
                control={form.control}
                name="productId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product</FormLabel>
                    <FormControl>
                      <Combobox
                        options={productOptions}
                        value={field.value}
                        onChange={field.onChange}
                        placeholder="Select product..."
                        searchPlaceholder="Type product name..."
                        loading={products.isLoading}
                        disabled={!canProceed}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Step picker */}
              <div className="space-y-1.5">
                <label
                  className={`text-sm font-medium ${stepError ? "text-destructive" : ""}`}
                >
                  Step
                </label>

                {!selectedProductId ? (
                  <p className="text-sm text-muted-foreground py-2">
                    Select a product first
                  </p>
                ) : steps.isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : stepGroups.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No steps defined for this product
                  </p>
                ) : (
                  <div className="border rounded-md divide-y">
                    {stepGroups.map((group) => {
                      if (group.isSubStepGroup) {
                        const substepIds = group.substeps.map((s) => s.id);
                        const selectedInGroup = substepIds.filter((id) =>
                          selectedStepIds.includes(id)
                        );
                        const isAllSelected =
                          substepIds.length > 0 &&
                          substepIds.every((id) => selectedStepIds.includes(id));
                        const isSomeSelected = selectedInGroup.length > 0;

                        // For the breakdown: compute allocation among selected substeps
                        const selectedSubsteps = group.substeps.filter((s) =>
                          selectedStepIds.includes(s.id)
                        );
                        const selectedSubstepTotal = selectedSubsteps.reduce(
                          (acc, s) => acc + Number(s.standardTimeMinutes),
                          0
                        );

                        return (
                          <div key={group.stepNumber}>
                            {/* Group header — shows parent name + "select all" toggle */}
                            <div
                              className={`flex items-center gap-3 px-4 py-2.5 border-b border-dashed border-border ${
                                isSomeSelected ? "bg-primary/5" : "bg-muted/20"
                              }`}
                            >
                              <span
                                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${
                                  isAllSelected
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : isSomeSelected
                                    ? "bg-primary/20 text-primary border-primary/40"
                                    : "border-muted-foreground/30 text-muted-foreground"
                                }`}
                              >
                                {group.stepNumber}
                              </span>
                              <span className="flex-1 min-w-0 text-sm">
                                <span className="font-medium">
                                  {group.parent ? group.parent.name : `Step ${group.stepNumber}`}
                                </span>
                                <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                                  ({group.substeps
                                    .map((s) => `${s.stepNumber}${s.subStepLabel}`)
                                    .join(" + ")})
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() => handleGroupToggle(group)}
                                className="text-xs text-primary hover:underline flex-shrink-0 font-medium"
                              >
                                {isAllSelected ? "Deselect all" : "Select all"}
                              </button>
                            </div>

                            {/* Individual substep rows — always visible */}
                            <div className="divide-y divide-border">
                              {group.substeps.map((s) => {
                                const isChecked = selectedStepIds.includes(s.id);
                                const ratio =
                                  group.substepTotal > 0
                                    ? Number(s.standardTimeMinutes) / group.substepTotal
                                    : 1 / group.substeps.length;
                                return (
                                  <label
                                    key={s.id}
                                    className={`flex items-center gap-3 pl-8 pr-4 py-2.5 cursor-pointer transition-colors text-sm ${
                                      isChecked
                                        ? "bg-primary/5 text-foreground"
                                        : "hover:bg-muted/40 text-muted-foreground"
                                    }`}
                                  >
                                    <Checkbox
                                      checked={isChecked}
                                      onCheckedChange={() =>
                                        handleSubstepToggle(s.id, group)
                                      }
                                      className="flex-shrink-0"
                                    />
                                    <span className="font-bold font-mono text-primary text-xs w-6 flex-shrink-0">
                                      {s.stepNumber}{s.subStepLabel}
                                    </span>
                                    <span className="flex-1 truncate">{s.name}</span>
                                    <span className="ml-auto font-mono text-xs text-muted-foreground flex-shrink-0">
                                      {s.standardTimeMinutes}s
                                      <span className="text-[10px] ml-1 opacity-60">
                                        ({Math.round(ratio * 100)}%)
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>

                            {/* Time breakdown — only shown when 2+ substeps selected */}
                            {selectedInGroup.length >= 2 && (
                              <div className="mx-4 mb-2 mt-1 rounded border border-primary/20 bg-primary/5 divide-y divide-primary/10 text-xs">
                                {selectedSubsteps.map((s) => {
                                  const ratio =
                                    selectedSubstepTotal > 0
                                      ? Number(s.standardTimeMinutes) / selectedSubstepTotal
                                      : 1 / selectedSubsteps.length;
                                  const allocatedMin =
                                    watchedTime && Number(watchedTime) > 0
                                      ? (Number(watchedTime) * ratio).toFixed(1)
                                      : null;
                                  return (
                                    <div
                                      key={s.id}
                                      className="flex items-center gap-2 px-3 py-1.5"
                                    >
                                      <span className="font-bold font-mono text-primary w-6 flex-shrink-0">
                                        {s.stepNumber}{s.subStepLabel}
                                      </span>
                                      <span className="text-muted-foreground truncate flex-1">
                                        {s.name}
                                      </span>
                                      <span className="font-mono text-muted-foreground flex-shrink-0">
                                        {Math.round(ratio * 100)}%
                                      </span>
                                      {allocatedMin && (
                                        <span className="font-mono font-semibold text-foreground flex-shrink-0 ml-1">
                                          → {allocatedMin} min
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      }

                      /* Regular (non-substep) step */
                      const s = group.members[0];
                      const isSelected = selectedStepIds.includes(s.id);
                      return (
                        <div key={group.stepNumber}>
                          <button
                            type="button"
                            onClick={() => handleGroupToggle(group)}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors ${
                              isSelected
                                ? "bg-primary/5 text-foreground font-medium"
                                : "hover:bg-muted/50"
                            }`}
                          >
                            <span
                              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 border ${
                                isSelected
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "border-muted-foreground/30 text-muted-foreground"
                              }`}
                            >
                              {s.stepNumber}
                            </span>
                            <span>{s.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground font-mono">
                              {s.standardTimeMinutes} sec
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {stepError && (
                  <p className="text-sm text-destructive">{stepError}</p>
                )}
              </div>

              {/* Selected steps summary */}
              {selectedSteps.length > 0 && (() => {
                const activeGroup = stepGroups.find(
                  (g) => g.isSubStepGroup && g.substeps.some((s) => selectedStepIds.includes(s.id))
                );
                if (activeGroup) {
                  return (
                    <div className="flex items-center gap-2 p-2.5 bg-muted rounded-sm text-sm flex-wrap">
                      <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-muted-foreground">
                        Step {activeGroup.stepNumber}:{" "}
                        {activeGroup.substeps.map((s) => `${s.stepNumber}${s.subStepLabel}`).join(" + ")}
                      </span>
                      <Badge variant="secondary" className="font-mono">
                        {activeGroup.substepTotal} sec total
                      </Badge>
                      <span className="text-xs text-muted-foreground">— split proportionally</span>
                    </div>
                  );
                }
                return (
                  <div className="flex items-center gap-2 p-2.5 bg-muted rounded-sm text-sm flex-wrap">
                    <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground">Standard time:</span>
                    <Badge variant="secondary" className="font-mono">
                      {selectedSteps[0].standardTimeMinutes} sec
                    </Badge>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* ── Work Details ── */}
          <Card className={!canProceed ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Work Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLineleaderMode && (
                <div className="flex items-center gap-2 rounded-sm bg-primary/5 border border-primary/20 px-3 py-2 text-xs text-muted-foreground">
                  <Users className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  <span>
                    Lineleader entry — efficiency = <span className="font-mono text-foreground">(qty / operators × std time) / time worked</span>
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="timeWorkedMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time Worked (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="e.g. 90"
                          data-testid="input-time-worked"
                          disabled={!canProceed}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="quantityCompleted"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity Completed</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="e.g. 12"
                          data-testid="input-quantity"
                          disabled={!canProceed}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>


              {isLineleaderMode && (
                <FormField
                  control={form.control}
                  name="operatorCount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5" />
                        Number of Operators
                      </FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min="0.1"
                          step="0.1"
                          placeholder="e.g. 8.5"
                          data-testid="input-operator-count"
                          disabled={!canProceed}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {isLineleaderMode && (() => {
                const stdSec = totalStandardTime; // stored in seconds
                const stdMin = stdSec / 60;
                const opCount = Number(watchedOpCount);
                const qty = Number(watchedQty);
                const timeWorked = Number(watchedTime);
                const hasAll = opCount > 0 && qty > 0 && timeWorked > 0 && stdMin > 0;
                const expected = hasAll ? (qty / opCount) * stdMin : null;
                const liveEff = expected !== null && timeWorked > 0 ? Math.round((expected / timeWorked) * 100) : null;

                const effColor =
                  liveEff === null ? "text-muted-foreground" :
                  liveEff >= 100 ? "text-emerald-600" :
                  liveEff >= 90 ? "text-amber-600" :
                  "text-red-500";

                return (
                  <div className="rounded-sm border border-border bg-muted/40 px-4 py-3 space-y-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Efficiency Preview</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <span className="text-muted-foreground">Std time (step 99)</span>
                      <span className="font-mono">{stdMin > 0 ? `${stdMin.toFixed(2)} min` : "—"}</span>
                      <span className="text-muted-foreground">Operators</span>
                      <span className="font-mono">{opCount > 0 ? opCount : "—"}</span>
                      <span className="text-muted-foreground">Pieces completed</span>
                      <span className="font-mono">{qty > 0 ? qty : "—"}</span>
                      <span className="text-muted-foreground">Expected time</span>
                      <span className="font-mono">{expected !== null ? `${expected.toFixed(2)} min` : "—"}</span>
                      <span className="text-muted-foreground">Time worked</span>
                      <span className="font-mono">{timeWorked > 0 ? `${timeWorked} min` : "—"}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                      <span className="text-xs text-muted-foreground font-medium">Efficiency</span>
                      <span className={`text-lg font-bold font-mono ${effColor}`}>
                        {liveEff !== null ? `${liveEff}%` : "—"}
                      </span>
                    </div>
                    {liveEff !== null && (
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, liveEff)}%`,
                            backgroundColor:
                              liveEff >= 100 ? "hsl(142, 71%, 45%)" :
                              liveEff >= 80 ? "hsl(38, 92%, 50%)" :
                              "hsl(0, 72%, 51%)",
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Any observations or remarks..."
                        rows={2}
                        data-testid="input-notes"
                        disabled={!canProceed}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="w-full"
            disabled={createReport.isPending || !canProceed}
            data-testid="button-submit-report"
          >
            {createReport.isPending
              ? "Submitting..."
              : (() => {
                  const activeGroup = stepGroups.find(
                    (g) => g.isSubStepGroup && g.substeps.some((s) => selectedStepIds.includes(s.id))
                  );
                  if (activeGroup) {
                    return `Submit Work Report (split across ${activeGroup.substeps.length} sub-steps)`;
                  }
                  return "Submit Work Report";
                })()}
          </Button>
        </form>
      </Form>
    </div>
  );
}
