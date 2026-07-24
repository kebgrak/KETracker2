import { Router } from "express";
import { db, workReportsTable, operatorsTable, productsTable, stepsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  CreateReportBody,
  CreateReportsBatchBody,
  ListReportsQueryParams,
  GetReportParams,
  DeleteReportParams,
} from "@workspace/api-zod";

async function fetchReportRows(query: { operatorId?: number; productId?: number; date?: string }) {
  const conditions = [];
  if (query.operatorId) conditions.push(eq(workReportsTable.operatorId, query.operatorId));
  if (query.productId) conditions.push(eq(workReportsTable.productId, query.productId));
  if (query.date) conditions.push(eq(workReportsTable.reportDate, query.date));

  const rows = await db
    .select({
      report: workReportsTable,
      operator: operatorsTable,
      product: productsTable,
      step: stepsTable,
    })
    .from(workReportsTable)
    .innerJoin(operatorsTable, eq(workReportsTable.operatorId, operatorsTable.id))
    .innerJoin(productsTable, eq(workReportsTable.productId, productsTable.id))
    .innerJoin(stepsTable, eq(workReportsTable.stepId, stepsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(workReportsTable.createdAt);

  return rows.map(({ report, operator, product, step }) => ({ ...report, operator, product, step }));
}

// Public: operators can list and submit reports
export const publicRouter = Router();

publicRouter.get("/reports", async (req, res) => {
  const query = ListReportsQueryParams.parse({
    operatorId: req.query.operatorId ? Number(req.query.operatorId) : undefined,
    productId: req.query.productId ? Number(req.query.productId) : undefined,
    date: req.query.date,
  });
  const normalizedQuery = {
    operatorId: query.operatorId,
    productId: query.productId,
    date: query.date ? String(query.date) : undefined,
  };
  res.json(await fetchReportRows(normalizedQuery));
});

publicRouter.get("/reports/:id", async (req, res) => {
  const { id } = GetReportParams.parse({ id: Number(req.params.id) });
  const [row] = await db
    .select({
      report: workReportsTable,
      operator: operatorsTable,
      product: productsTable,
      step: stepsTable,
    })
    .from(workReportsTable)
    .innerJoin(operatorsTable, eq(workReportsTable.operatorId, operatorsTable.id))
    .innerJoin(productsTable, eq(workReportsTable.productId, productsTable.id))
    .innerJoin(stepsTable, eq(workReportsTable.stepId, stepsTable.id))
    .where(eq(workReportsTable.id, id));
  if (!row) { res.status(404).json({ error: "Report not found" }); return; }
  res.json({ ...row.report, operator: row.operator, product: row.product, step: row.step });
});

publicRouter.post("/reports", async (req, res) => {
  const payload = req.body as unknown;
  let entries: Array<Awaited<ReturnType<typeof CreateReportBody.parse>>> = [];

  if (Array.isArray(payload)) {
    entries = payload.map((entry) => CreateReportBody.parse(entry));
  } else if (payload && typeof payload === "object" && "entries" in payload && Array.isArray((payload as { entries?: unknown }).entries)) {
    const batch = CreateReportsBatchBody.parse(payload);
    entries = batch.entries;
  } else {
    entries = [CreateReportBody.parse(payload)];
  }

  if (entries.length === 0) {
    res.status(400).json({ error: "At least one report entry is required." });
    return;
  }

  try {
    const createdReports = await db.transaction(async (tx) => {
      const results = [] as Array<{
        id: number;
        operatorId: number;
        productId: number;
        stepId: number;
        timeWorkedMinutes: string;
        quantityCompleted: number;
        operatorCount: string | null;
        reportDate: string;
        notes: string | null;
        createdAt: Date;
      }>;

      for (const body of entries) {
        const rd = body.reportDate;
        const reportDate = `${rd.getUTCFullYear()}-${String(rd.getUTCMonth() + 1).padStart(2, "0")}-${String(rd.getUTCDate()).padStart(2, "0")}`;

        const [submittedStep, operatorExists, productExists, stepExists] = await Promise.all([
          tx.select({ stepNumber: stepsTable.stepNumber }).from(stepsTable).where(eq(stepsTable.id, body.stepId)).limit(1),
          tx.select({ id: operatorsTable.id }).from(operatorsTable).where(eq(operatorsTable.id, body.operatorId)).limit(1),
          tx.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.id, body.productId)).limit(1),
          tx.select({ id: stepsTable.id }).from(stepsTable).where(eq(stepsTable.id, body.stepId)).limit(1),
        ]);

        if (!operatorExists[0] || !productExists[0] || !stepExists[0]) {
          throw Object.assign(new Error("One or more referenced records could not be found."), { status: 400 });
        }

        if (submittedStep[0]?.stepNumber === 99) {
          const existing = await tx
            .select({ id: workReportsTable.id })
            .from(workReportsTable)
            .innerJoin(stepsTable, eq(workReportsTable.stepId, stepsTable.id))
            .where(
              and(
                eq(workReportsTable.productId, body.productId),
                eq(workReportsTable.reportDate, reportDate),
                eq(stepsTable.stepNumber, 99),
              ),
            )
            .limit(1);

          if (existing.length > 0) {
            const [product] = await tx
              .select({ name: productsTable.name })
              .from(productsTable)
              .where(eq(productsTable.id, body.productId))
              .limit(1);

            const d = new Date(reportDate + "T00:00:00");
            const displayDate = d.toLocaleDateString("en-GB", {
              day: "numeric", month: "long", year: "numeric",
            });
            throw Object.assign(new Error(`For ${displayDate} for product "${product?.name ?? String(body.productId)}" a Step 99 report has already been entered`), { status: 409 });
          }
        }

        try {
          const [report] = await tx.insert(workReportsTable).values({
            operatorId: body.operatorId,
            productId: body.productId,
            stepId: body.stepId,
            timeWorkedMinutes: String(body.timeWorkedMinutes),
            quantityCompleted: body.quantityCompleted,
            operatorCount: body.operatorCount != null ? String(body.operatorCount) : null,
            reportDate,
            notes: body.notes ?? null,
          }).returning();
          results.push(report);
        } catch (error) {
          const pgError = error as Error & { code?: string };
          if (pgError.code === "23505") {
            throw Object.assign(new Error("A duplicate report entry was rejected by the database."), { status: 409 });
          }
          if (pgError.code === "23503") {
            throw Object.assign(new Error("One or more referenced records could not be found."), { status: 400 });
          }
          throw error;
        }
      }

      return results;
    });

    if (entries.length === 1) {
      const [report] = createdReports;
      const [operator] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, report.operatorId));
      const [product] = await db.select().from(productsTable).where(eq(productsTable.id, report.productId));
      const [step] = await db.select().from(stepsTable).where(eq(stepsTable.id, report.stepId));
      res.status(201).json({ ...report, operator, product, step });
      return;
    }

    const response = await Promise.all(createdReports.map(async (report) => {
      const [operator] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, report.operatorId));
      const [product] = await db.select().from(productsTable).where(eq(productsTable.id, report.productId));
      const [step] = await db.select().from(stepsTable).where(eq(stepsTable.id, report.stepId));
      return { ...report, operator, product, step };
    }));

    res.status(201).json(response);
  } catch (error) {
    const apiError = error as Error & { status?: number };
    if (apiError.status) {
      res.status(apiError.status).json({ error: apiError.message });
      return;
    }
    throw error;
  }
});

// Admin: delete reports
export const adminRouter = Router();

adminRouter.delete("/reports/:id", async (req, res) => {
  const { id } = DeleteReportParams.parse({ id: Number(req.params.id) });
  await db.delete(workReportsTable).where(eq(workReportsTable.id, id));
  res.status(204).end();
});

export default { publicRouter, adminRouter };
