import { pgTable, serial, text, boolean, integer, numeric, date, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const operatorsTable = pgTable("operators", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  employeeId: text("employee_id").notNull().unique(),
  isAdmin: boolean("is_admin").notNull().default(false),
  isLineleader: boolean("is_lineleader").notNull().default(false),
  isModerator: boolean("is_moderator").notNull().default(false),
  email: text("email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOperatorSchema = createInsertSchema(operatorsTable).omit({ id: true, createdAt: true });
export type InsertOperator = z.infer<typeof insertOperatorSchema>;
export type Operator = typeof operatorsTable.$inferSelect;

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  revision: text("revision"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const stepsTable = pgTable("steps", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  subStepLabel: text("sub_step_label"),
  name: text("name").notNull(),
  description: text("description"),
  standardTimeMinutes: numeric("standard_time_minutes", { precision: 8, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertStepSchema = createInsertSchema(stepsTable).omit({ id: true, createdAt: true });
export type InsertStep = z.infer<typeof insertStepSchema>;
export type Step = typeof stepsTable.$inferSelect;

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const weeklyPlansTable = pgTable("weekly_plans", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => productsTable.id, { onDelete: "cascade" }),
  weekStart: date("week_start").notNull(),
  plannedQuantity: integer("planned_quantity").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  unique("weekly_plans_unique_product_week").on(table.productId, table.weekStart),
]);

export const insertWeeklyPlanSchema = createInsertSchema(weeklyPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWeeklyPlan = z.infer<typeof insertWeeklyPlanSchema>;
export type WeeklyPlan = typeof weeklyPlansTable.$inferSelect;

export const workReportsTable = pgTable("work_reports", {
  id: serial("id").primaryKey(),
  operatorId: integer("operator_id").notNull().references(() => operatorsTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  stepId: integer("step_id").notNull().references(() => stepsTable.id),
  timeWorkedMinutes: numeric("time_worked_minutes", { precision: 8, scale: 2 }).notNull(),
  quantityCompleted: integer("quantity_completed").notNull(),
  operatorCount: numeric("operator_count", { precision: 5, scale: 1 }),
  reportDate: date("report_date").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  unique("work_reports_unique_product_date_step").on(table.productId, table.reportDate, table.stepId),
]);

export const insertWorkReportSchema = createInsertSchema(workReportsTable).omit({ id: true, createdAt: true });
export type InsertWorkReport = z.infer<typeof insertWorkReportSchema>;
export type WorkReport = typeof workReportsTable.$inferSelect;
