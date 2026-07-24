import { Router } from "express";
import { db, operatorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateOperatorBody,
  GetOperatorParams,
  UpdateOperatorBody,
  UpdateOperatorParams,
  DeleteOperatorParams,
} from "@workspace/api-zod";

// Public: read-only
export const publicRouter = Router();

const publicOperatorProjection = {
  id: operatorsTable.id,
  name: operatorsTable.name,
  employeeId: operatorsTable.employeeId,
  isLineleader: operatorsTable.isLineleader,
  createdAt: operatorsTable.createdAt,
};

publicRouter.get("/operators", async (req, res) => {
  const operators = await db.select(publicOperatorProjection).from(operatorsTable).orderBy(operatorsTable.name);
  res.json(operators);
});

publicRouter.get("/operators/:id", async (req, res) => {
  const { id } = GetOperatorParams.parse({ id: Number(req.params.id) });
  const [operator] = await db.select(publicOperatorProjection).from(operatorsTable).where(eq(operatorsTable.id, id));
  if (!operator) { res.status(404).json({ error: "Operator not found" }); return; }
  res.json(operator);
});

// Admin: create / update / delete
export const adminRouter = Router();

adminRouter.post("/operators", async (req, res) => {
  const body = CreateOperatorBody.parse(req.body);
  const [operator] = await db.insert(operatorsTable).values(body).returning();
  res.status(201).json(operator);
});

adminRouter.put("/operators/:id", async (req, res) => {
  const { id } = UpdateOperatorParams.parse({ id: Number(req.params.id) });
  const body = UpdateOperatorBody.parse(req.body);
  const [operator] = await db.update(operatorsTable).set(body).where(eq(operatorsTable.id, id)).returning();
  if (!operator) { res.status(404).json({ error: "Operator not found" }); return; }
  res.json(operator);
});

adminRouter.delete("/operators/:id", async (req, res) => {
  const { id } = DeleteOperatorParams.parse({ id: Number(req.params.id) });
  await db.delete(operatorsTable).where(eq(operatorsTable.id, id));
  res.status(204).end();
});

export default { publicRouter, adminRouter };
