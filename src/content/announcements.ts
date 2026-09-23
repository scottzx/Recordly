import type { AnnouncementFeed } from "@/lib/announcements";

/** Announcements bundled with a release. Use a new ID when an item should be shown again. */
export const BUNDLED_ANNOUNCEMENT_FEED: AnnouncementFeed = {
	settings: {
		aspectRatio: "4:3",
	},
	announcements: [
		{
			id: "recordly-1.5-beta-1",
			title: "Recordly 1.5 beta is ready",
			body: "Open a recent project or start a new recording from launch. Auto captions are more complete, clips can keep only timestamped speech, and the camera stays off until you record.",
			presentation: "banner",
			audience: "editor",
			priority: 20,
			maxImpressions: 3,
			action: {
				label: "See captions",
				section: "captions",
			},
		},
	],
};
