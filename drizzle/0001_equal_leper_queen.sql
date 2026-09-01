CREATE TABLE `llm_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
