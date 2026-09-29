ALTER TABLE `membranes` ADD `rec_flux_min_lmh` real;--> statement-breakpoint
ALTER TABLE `membranes` ADD `rec_flux_max_lmh` real;--> statement-breakpoint
ALTER TABLE `membranes` ADD `max_element_recovery_pct` real;--> statement-breakpoint
ALTER TABLE `membranes` ADD `min_concentrate_m3h` real;--> statement-breakpoint
ALTER TABLE `membranes` ADD `max_element_dp_bar` real;--> statement-breakpoint
ALTER TABLE `membranes` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `membranes` ADD `data_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `pipe_materials` ADD `hazen_c` real DEFAULT 140 NOT NULL;--> statement-breakpoint
ALTER TABLE `pumps` ADD `curve` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `pumps` ADD `is_demo` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `membranes` SET `is_demo` = 1, `data_source` = 'Seeded by version 1 with unverified typical values – NOT verified manufacturer data. Replace with the manufacturer datasheet values.' WHERE `builtin` = 1;--> statement-breakpoint
UPDATE `pumps` SET `is_demo` = 1 WHERE `builtin` = 1;--> statement-breakpoint
UPDATE `pipe_materials` SET `hazen_c` = 150 WHERE `name` IN ('PVC-U PN16', 'HDPE PE100 SDR11 (PN16)');
