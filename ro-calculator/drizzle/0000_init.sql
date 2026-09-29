CREATE TABLE `membranes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manufacturer` text NOT NULL,
	`model` text NOT NULL,
	`membrane_type` text DEFAULT 'BWRO' NOT NULL,
	`diameter_in` real DEFAULT 8 NOT NULL,
	`active_area_m2` real,
	`nominal_flow_m3d` real,
	`salt_rejection_pct` real,
	`max_pressure_bar` real,
	`max_temp_c` real,
	`ph_min` real,
	`ph_max` real,
	`test_pressure_bar` real,
	`test_tds_mg_l` real,
	`test_recovery_pct` real,
	`max_feed_flow_m3h` real,
	`notes` text DEFAULT '' NOT NULL,
	`builtin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pipe_materials` (
	`name` text PRIMARY KEY NOT NULL,
	`roughness_mm` real NOT NULL,
	`description` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pipe_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material` text NOT NULL,
	`dn` integer NOT NULL,
	`outer_diameter_mm` real NOT NULL,
	`wall_mm` real NOT NULL,
	`inner_diameter_mm` real NOT NULL,
	`pressure_rating_bar` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipe_sizes_material_dn` ON `pipe_sizes` (`material`,`dn`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`customer` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pumps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pump_type` text NOT NULL,
	`manufacturer` text NOT NULL,
	`model` text NOT NULL,
	`rated_flow_m3h` real NOT NULL,
	`rated_head_m` real NOT NULL,
	`min_flow_m3h` real NOT NULL,
	`max_flow_m3h` real NOT NULL,
	`shutoff_head_m` real NOT NULL,
	`motor_kw` real NOT NULL,
	`efficiency_pct` real NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`builtin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
