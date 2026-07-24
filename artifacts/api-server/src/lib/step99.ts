import { db, stepsTable, productsTable } from "@workspace/db";
import { and, eq, isNull, ne } from "drizzle-orm";

export const STEP_99_NUMBER = 99;
export const STEP_99_NAME = "Ready parts for the day";

export async function upsertStep99(productId: number): Promise<void> {
  const rootSteps = await db
    .select({ stdTime: stepsTable.standardTimeMinutes })
    .from(stepsTable)
    .where(
      and(
        eq(stepsTable.productId, productId),
        isNull(stepsTable.subStepLabel),
        ne(stepsTable.stepNumber, STEP_99_NUMBER),
      ),
    );

  const totalTime = rootSteps.reduce((sum, s) => sum + Number(s.stdTime), 0);

  const existing = await db
    .select({ id: stepsTable.id })
    .from(stepsTable)
    .where(
      and(
        eq(stepsTable.productId, productId),
        eq(stepsTable.stepNumber, STEP_99_NUMBER),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(stepsTable)
      .set({
        standardTimeMinutes: String(totalTime),
        name: STEP_99_NAME,
        subStepLabel: null,
      })
      .where(eq(stepsTable.id, existing[0].id));
  } else {
    await db.insert(stepsTable).values({
      productId,
      stepNumber: STEP_99_NUMBER,
      subStepLabel: null,
      name: STEP_99_NAME,
      description: null,
      standardTimeMinutes: String(totalTime),
    });
  }
}

export async function initAllStep99(): Promise<void> {
  const products = await db.select({ id: productsTable.id }).from(productsTable);
  const batchSize = 4;

  for (let index = 0; index < products.length; index += batchSize) {
    const batch = products.slice(index, index + batchSize);
    for (const product of batch) {
      await upsertStep99(product.id);
    }
  }
}
