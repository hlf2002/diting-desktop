CREATE TABLE `focus_entries` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`is_focus` integer DEFAULT false NOT NULL,
	`analyzed_at` integer
);
