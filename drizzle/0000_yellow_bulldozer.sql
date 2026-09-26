CREATE TABLE `refresh_locks` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_snapshots` (
	`source_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`next_attempt` integer NOT NULL
);
