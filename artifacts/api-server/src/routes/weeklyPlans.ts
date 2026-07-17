import { Router } from "express";
import { db, weeklyPlansTable, productsTable, workReportsTable, stepsTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  ListWeeklyPlansQueryParams,
  CreateWeeklyPlanBody,
  GetWeeklyProgressQueryParams,
} from "@workspace/api-zod";

export const publicRouter = Router();
export const adminRouter = Router();

// ── GET /api/weekly-plans ─────────────────────────────────────────────────────
publicRouter.get("/weekly-plans", async (req, res) => {
  // We use parse to validate, but since req.query.weekStart is a string "YYYY-MM-DD",
  // and ListWeeklyPlansQueryParams.weekStart is zod.date(), Zod might try to parse it.
  // If it's already a valid date string, we can just use it after validation.
  const { weekStart: ws } = ListWeeklyPlansQueryParams.parse({
    weekStart: req.query.weekStart,
  });
  // Ensure we have a YYYY-MM-DD string for the database
  const weekStart = ws instanceof Date ? ws.toISOString().split("T")[0] : String(ws);

  const rows = await db
    .select({
      plan: weeklyPlansTable,
      product: productsTable,
    })
    .from(weeklyPlansTable)
    .innerJoin(productsTable, eq(weeklyPlansTable.productId, productsTable.id))
    .where(eq(weeklyPlansTable.weekStart, weekStart));

  res.json(
    rows.map(({ plan, product }) => ({
      ...plan,
      product,
    })),
  );
});

// ── POST /api/weekly-plans ─────────────────────────────────────────────────────
adminRouter.post("/weekly-plans", async (req, res) => {
  const body = CreateWeeklyPlanBody.parse(req.body);
  const productId = body.productId;
  const weekStart = body.weekStart.toISOString().split("T")[0];
  const plannedQuantity = body.plannedQuantity;

  // Upsert: delete any existing plan for this product+week, then insert
  await db
    .delete(weeklyPlansTable)
    .where(
      and(
        eq(weeklyPlansTable.productId, productId),
        eq(weeklyPlansTable.weekStart, weekStart),
      ),
    );

  const [inserted] = await db
    .insert(weeklyPlansTable)
    .values({
      productId,
      weekStart,
      plannedQuantity,
    })
    .returning();

  const [row] = await db
    .select({
      plan: weeklyPlansTable,
      product: productsTable,
    })
    .from(weeklyPlansTable)
    .innerJoin(productsTable, eq(weeklyPlansTable.productId, productsTable.id))
    .where(eq(weeklyPlansTable.id, inserted.id));

  res.status(201).json({
    ...row.plan,
    product: row.product,
  });
});

// ── DELETE /api/weekly-plans/:id ──────────────────────────────────────────────
adminRouter.delete("/weekly-plans/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid plan ID" });
    return;
  }
  await db.delete(weeklyPlansTable).where(eq(weeklyPlansTable.id, id));
  res.status(204).send();
});

// ── GET /api/weekly-plans/progress ────────────────────────────────────────────
publicRouter.get("/weekly-plans/progress", async (req, res) => {
  const { weekStart: ws } = GetWeeklyProgressQueryParams.parse({
    weekStart: req.query.weekStart,
  });
  const weekStart = ws instanceof Date ? ws.toISOString().split("T")[0] : String(ws);

  // Compute week end (Sunday)
  const start = new Date(weekStart + "T00:00:00");
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const weekEnd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;

  // Get all products with their plans for this week
  const productsWithPlans = await db
    .select({
      product: productsTable,
      plan: weeklyPlansTable,
    })
    .from(productsTable)
    .leftJoin(
      weeklyPlansTable,
      and(
        eq(weeklyPlansTable.productId, productsTable.id),
        eq(weeklyPlansTable.weekStart, weekStart),
      ),
    );

  // Get step 99 reports for each product in this week
  const step99 = db.$with("step99").as(
    db.select().from(stepsTable).where(eq(stepsTable.stepNumber, 99))
  );

  const reports = await db
    .with(step99)
    .select({
      productId: workReportsTable.productId,
      quantityCompleted: workReportsTable.quantityCompleted,
    })
    .from(workReportsTable)
    .innerJoin(step99, eq(workReportsTable.stepId, step99.id))
    .where(
      and(
        gte(workReportsTable.reportDate, weekStart),
        lte(workReportsTable.reportDate, weekEnd),
      ),
    );

  // Aggregate completed by product
  const completedByProduct = new Map<number, number>();
  for (const r of reports) {
    const current = completedByProduct.get(r.productId) ?? 0;
    completedByProduct.set(r.productId, current + (r.quantityCompleted ?? 0));
  }

  const result = productsWithPlans.map(({ product, plan }) => {
    const planned = plan?.plannedQuantity ?? 0;
    const completed = completedByProduct.get(product.id) ?? 0;
    const remaining = Math.max(0, planned - completed);
    const pct = planned > 0 ? Math.round((completed / planned) * 100) : 0;
    return {
      productId: product.id,
      productName: product.name,
      plannedQuantity: planned,
      completedQuantity: completed,
      remainingQuantity: remaining,
      percentageComplete: pct,
      planId: plan?.id ?? null,
    };
  });

  res.json(result);
});

export default { publicRouter, adminRouter };
