CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`uploaded_name` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`evaluator_id` text NOT NULL,
	`evaluator_name` text NOT NULL,
	`query_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`intent` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_reviews_evaluator_pair_intent` ON `reviews` (`evaluator_id`,`query_id`,`candidate_id`,`intent`);