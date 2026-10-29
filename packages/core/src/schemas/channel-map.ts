/**
 * ChannelMap schema — SPEC §6.13 (packages/plan owns the map, Q6)
 *
 * Channel id -> playbook section (file + heading). Channel ids in
 * archetypes.yaml are labels; they are validated against this map,
 * not against channels.md.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const ChannelMapEntrySchema = z
  .object({
    file: z.string().min(1).describe("Playbook file, e.g. 'channels.md' or 'content-engine.md'."),
    heading: z.string().min(1).describe("Heading/section inside that file."),
    description: z.string().min(1).optional(),
  })
  .strict();
export type ChannelMapEntry = z.infer<typeof ChannelMapEntrySchema>;

export const ChannelMapSchema = z
  .record(z.string().min(1), ChannelMapEntrySchema)
  .refine((m) => Object.keys(m).length > 0, "ChannelMap must contain at least one channel");
export type ChannelMap = z.infer<typeof ChannelMapSchema>;

/** True if the channel id exists in the map. */
export function isChannelInMap(channelMap: ChannelMap, channelId: string): boolean {
  return channelId in channelMap;
}

/** Channel ids (in input order, deduplicated) that are missing from the map. */
export function findMissingChannelIds(channelIds: readonly string[], channelMap: ChannelMap): string[] {
  return [...new Set(channelIds.filter((id) => !(id in channelMap)))];
}

export const ChannelMapJsonSchema = zodToJsonSchema(ChannelMapSchema, { name: "ChannelMap", $refStrategy: "none", target: "jsonSchema7" });
