import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedName: text("uploaded_name").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  evaluatorId: text("evaluator_id").notNull(),
  evaluatorName: text("evaluator_name").notNull(),
  queryId: text("query_id").notNull(),
  candidateId: text("candidate_id").notNull(),
  intent: text("intent").notNull(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_reviews_evaluator_pair_intent").on(table.evaluatorId, table.queryId, table.candidateId, table.intent),
]);

export const llmRuns = sqliteTable("llm_runs", {
  id: text("id").primaryKey(),
  queryId: text("query_id").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at").notNull(),
});
