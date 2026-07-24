import { Router } from "express";
import { db, productsTable, stepsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateProductBody,
  GetProductParams,
  UpdateProductBody,
  UpdateProductParams,
  DeleteProductParams,
} from "@workspace/api-zod";
import { upsertStep99 } from "../lib/step99";

// Public: read-only
export const publicRouter = Router();

const publicProductProjection = {
  id: productsTable.id,
  name: productsTable.name,
  description: productsTable.description,
  revision: productsTable.revision,
  createdAt: productsTable.createdAt,
};

const publicStepProjection = {
  id: stepsTable.id,
  productId: stepsTable.productId,
  stepNumber: stepsTable.stepNumber,
  subStepLabel: stepsTable.subStepLabel,
  name: stepsTable.name,
  description: stepsTable.description,
  standardTimeMinutes: stepsTable.standardTimeMinutes,
  createdAt: stepsTable.createdAt,
};

publicRouter.get("/products", async (req, res) => {
  const products = await db.select(publicProductProjection).from(productsTable).orderBy(productsTable.name);
  res.json(products);
});

publicRouter.get("/products/:id", async (req, res) => {
  const { id } = GetProductParams.parse({ id: Number(req.params.id) });
  const [product] = await db.select(publicProductProjection).from(productsTable).where(eq(productsTable.id, id));
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const steps = await db
    .select(publicStepProjection)
    .from(stepsTable)
    .where(eq(stepsTable.productId, id))
    .orderBy(stepsTable.stepNumber);
  res.json({ ...product, steps });
});

// Admin: create / update / delete
export const adminRouter = Router();

adminRouter.post("/products", async (req, res) => {
  const body = CreateProductBody.parse(req.body);
  const [product] = await db.insert(productsTable).values(body).returning();
  await upsertStep99(product.id);
  res.status(201).json(product);
});

adminRouter.put("/products/:id", async (req, res) => {
  const { id } = UpdateProductParams.parse({ id: Number(req.params.id) });
  const body = UpdateProductBody.parse(req.body);
  const [product] = await db.update(productsTable).set(body).where(eq(productsTable.id, id)).returning();
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  await upsertStep99(product.id);
  res.json(product);
});

adminRouter.post("/products/:id/duplicate", async (req, res) => {
  const { id } = GetProductParams.parse({ id: Number(req.params.id) });
  const [source] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  if (!source) { res.status(404).json({ error: "Product not found" }); return; }

  const [newProduct] = await db
    .insert(productsTable)
    .values({ name: `${source.name} (copy)`, description: source.description, revision: source.revision })
    .returning();

  // Copy only non-step-99 steps, then let upsertStep99 create a fresh step 99
  const sourceSteps = await db.select().from(stepsTable).where(eq(stepsTable.productId, id));
  const stepsToClone = sourceSteps.filter((s) => s.stepNumber !== 99);
  if (stepsToClone.length > 0) {
    await db.insert(stepsTable).values(
      stepsToClone.map(({ productId: _pid, id: _sid, createdAt: _ca, ...rest }) => ({
        ...rest,
        productId: newProduct.id,
      }))
    );
  }
  await upsertStep99(newProduct.id);

  res.status(201).json(newProduct);
});

adminRouter.delete("/products/:id", async (req, res) => {
  const { id } = DeleteProductParams.parse({ id: Number(req.params.id) });
  await db.delete(productsTable).where(eq(productsTable.id, id));
  res.status(204).end();
});

export default { publicRouter, adminRouter };
