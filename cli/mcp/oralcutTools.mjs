import { oralcutCommand } from "../core/oralcut.mjs";
import { requireInput } from "../../shared/transcript.ts";
const str = { type: "string", minLength: 1 },
	strings = { type: "array", items: str };
const define = (name, properties, required, description) => ({
	name: `recordly_${name}`,
	description,
	inputSchema: { type: "object", additionalProperties: false, properties, required },
});
export const oralcutTools = [
	define("library_list", { query: str }, [], "List local media and processing status."),
	define(
		"library_import",
		{ inputPath: str },
		["inputPath"],
		"Register and analyze an existing local video; does not copy the source.",
	),
	define(
		"project_create",
		{ mediaIds: strings, output: str },
		["mediaIds", "output"],
		"Create a new project in the supplied media order. Never overwrites output.",
	),
	define(
		"transcript_generate",
		{
			inputPath: str,
			sourceSelections: { type: "object", additionalProperties: str },
			output: str,
			engine: { type: "string", enum: ["whisper", "transcribe-kit"] },
			model: str,
			executable: str,
			language: str,
		},
		["inputPath", "output"],
		"Transcribe selected narration sources with the shared local engine and cache.",
	),
	define(
		"transcript_export",
		{ inputPath: str, format: { type: "string", enum: ["markdown"] }, output: str },
		["inputPath", "format", "output"],
		"Export complete transcripts with immutable source references.",
	),
	define(
		"review_create",
		{
			inputPath: str,
			transcriptPath: str,
			suggestionsPath: str,
			pauses: { type: "boolean" },
			output: str,
		},
		["inputPath", "transcriptPath", "output"],
		"Create a review from exactly one of suggestionsPath or pauses=true.",
	),
	define(
		"review_inspect",
		{ inputPath: str },
		["inputPath"],
		"Inspect suggestions, pending decisions and conflicts without editing.",
	),
	define(
		"review_apply",
		{
			inputPath: str,
			projectPath: str,
			acceptedIds: strings,
			dryRun: { type: "boolean" },
			output: str,
		},
		["inputPath", "projectPath", "acceptedIds"],
		"Apply only selected suggestions to a new output, or validate with dryRun=true. Checks base and media identity.",
	),
];
function validate(value, schema, label) {
	if (schema.type === "object") {
		requireInput(
			value && typeof value === "object" && !Array.isArray(value),
			`${label} must be an object`,
		);
		for (const key of schema.required ?? [])
			requireInput(Object.hasOwn(value, key), `Missing ${key}`);
		for (const [key, item] of Object.entries(value)) {
			const child = schema.properties?.[key];
			if (child) validate(item, child, key);
			else if (schema.additionalProperties && typeof schema.additionalProperties === "object")
				validate(item, schema.additionalProperties, key);
			else requireInput(schema.additionalProperties !== false, `Unknown argument: ${key}`);
		}
	} else if (schema.type === "array") {
		requireInput(Array.isArray(value), `${label} must be an array`);
		value.forEach((item) => validate(item, schema.items, label));
	} else
		requireInput(
			typeof value === schema.type && (!schema.minLength || value.length >= schema.minLength),
			`Invalid ${label}`,
		);
	if (schema.enum) requireInput(schema.enum.includes(value), `Invalid ${label}`);
}
export async function callOralcutTool(name, args) {
	const tool = oralcutTools.find((t) => t.name === name);
	requireInput(tool, `Unknown tool: ${name}`);
	validate(args, tool.inputSchema, name);
	const [command, action] = name.replace("recordly_", "").split("_");
	return oralcutCommand(command, action, args.inputPath, args);
}
