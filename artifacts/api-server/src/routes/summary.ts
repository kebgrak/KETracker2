import { Router } from "express";
import { db, workReportsTable, operatorsTable, productsTable, stepsTable } from "@workspace/db";
import { and, eq, count, sum, ne, desc, or, isNull } from "drizzle-orm";

const router = Router();

// All summary routes are scoped to step 99 ("Ready parts for the day") reports only

router.get("/summary/dashboard", async (req, res) => {
  const [operatorCount] = await db.select({ count: count() }).from(operatorsTable);
  const [productCount] = await db.select({ count: count() }).from(productsTable);

  const [totals] = await db
    .select({
      totalReports: count(),
      totalQuantity: sum(workReportsTable.quantityCompleted),
      totalTime: sum(workReportsTable.timeWorkedMinutes),
    })
    .from(workReportsTable)
    .innerJoin(stepsTable, eq(workReportsTable.stepId, stepsTable.id))
    .where(eq(stepsTable.stepNumber, 99));

  const recentRows = await db
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
    .where(eq(stepsTable.stepNumber, 99))
    .orderBy(desc(workReportsTable.createdAt))
    .limit(20);

  const recentReports = recentRows.map(({ report, operator, product, step }) => ({
    ...report,
    operator,
    product,
    step,
  }));

  res.json({
    totalOperators: operatorCount.count,
    totalProducts: productCount.count,
    totalReports: totals.totalReports,
    totalQuantityCompleted: Number(totals.totalQuantity ?? 0),
    totalTimeMinutes: Number(totals.totalTime ?? 0),
    recentReports,
  });
});

router.get("/summary/operator-stats", async (req, res) => {
  const stats = await db
    .select({
      operatorId: operatorsTable.id,
      operatorName: operatorsTable.name,
      employeeId: operatorsTable.employeeId,
      totalReports: count(workReportsTable.id),
      totalQuantityCompleted: sum(workReportsTable.quantityCompleted),
      totalTimeMinutes: sum(workReportsTable.timeWorkedMinutes),
    })
    .from(operatorsTable)
    .leftJoin(workReportsTable, eq(workReportsTable.operatorId, operatorsTable.id))
    .leftJoin(stepsTable, eq(workReportsTable.stepId, stepsTable.id))
    .where(and(eq(operatorsTable.isLineleader, false), or(isNull(stepsTable.stepNumber), ne(stepsTable.stepNumber, 99))))
    .groupBy(operatorsTable.id, operatorsTable.name, operatorsTable.employeeId);

  res.json(
    stats.map((row) => ({
      operatorId: row.operatorId,
      operatorName: row.operatorName,
      employeeId: row.employeeId,
      totalReports: row.totalReports,
      totalQuantityCompleted: Number(row.totalQuantityCompleted ?? 0),
      totalTimeMinutes: Number(row.totalTimeMinutes ?? 0),
    })),
  );
});

router.get("/summary/product-stats", async (req, res) => {
  const stepCounts = await db
    .select({
      productId: stepsTable.productId,
      stepCount: count(),
    })
    .from(stepsTable)
    .groupBy(stepsTable.productId);

  const stepCountMap = new Map<number, number>(stepCounts.map((row) => [row.productId, row.stepCount]));

  const stats = await db
    .select({
      productId: productsTable.id,
      productName: productsTable.name,
      totalReports: count(workReportsTable.id),
      totalQuantityCompleted: sum(workReportsTable.quantityCompleted),
      totalTimeMinutes: sum(workReportsTable.timeWorkedMinutes),
    })
    .from(productsTable)
    .leftJoin(workReportsTable, eq(workReportsTable.productId, productsTable.id))
    .leftJoin(stepsTable, eq(workReportsTable.stepId, stepsTable.id))
    .where(or(isNull(stepsTable.stepNumber), eq(stepsTable.stepNumber, 99)))
    .groupBy(productsTable.id, productsTable.name);

  res.json(
    stats.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      totalReports: row.totalReports,
      totalQuantityCompleted: Number(row.totalQuantityCompleted ?? 0),
      totalTimeMinutes: Number(row.totalTimeMinutes ?? 0),
      stepCount: stepCountMap.get(row.productId) ?? 0,
    })),
  );
});

export default router;
