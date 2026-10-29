/**
 * ConnectorsRegistry schema — SPEC §6.10 (connectors.yaml shape, §2.1)
 *
 * version, verified date, status_values, approval_classes, hubs,
 * capabilities -> routes[{via, tool?, status, class, note?}].
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ApprovalClassSchema } from "./task.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const ConnectorStatusSchema = z.enum(["live", "custom", "hub", "browser", "manual"]);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const ConnectorRouteSchema = z
  .object({
    via: z.string().min(1).describe("Route origin, e.g. 'muse', 'custom', 'composio', 'browser'."),
    tool: z.string().min(1).optional().describe("Tool/connector name; omitted for via-only routes (e.g. github-actions-status)."),
    status: ConnectorStatusSchema,
    class: ApprovalClassSchema,
    note: z.string().min(1).optional(),
  })
  // Not .strict(): connectors.yaml writes routes in flow style with unquoted
  // notes containing commas, which YAML parses as extra keys. Strip them.
  .strip();
export type ConnectorRoute = z.infer<typeof ConnectorRouteSchema>;

export const ConnectorCapabilitySchema = z
  .object({
    purpose: z.string().min(1),
    routes: z.array(ConnectorRouteSchema).min(1),
    verify: z.string().min(1).optional().describe("Optional verification step from connectors.yaml."),
  })
  .strict();
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export const ConnectorHubSchema = z
  .object({
    kind: z.string().min(1),
    reach: z.string().min(1).optional(),
    setup: z.string().min(1).optional(),
    auth: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    license: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    url_cloud: z.string().min(1).optional(),
    url_self_hosted: z.string().min(1).optional(),
    cautions: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type ConnectorHub = z.infer<typeof ConnectorHubSchema>;

export const ConnectorsRegistrySchema = z
  .object({
    version: z.number().int().min(1),
    verified: date.describe("Last full verification date of the registry."),
    status_values: z
      .object({ live: z.string().min(1), custom: z.string().min(1), hub: z.string().min(1), browser: z.string().min(1), manual: z.string().min(1) })
      .strict(),
    approval_classes: z.object({ A: z.string().min(1), B: z.string().min(1), C: z.string().min(1) }).strict(),
    hubs: z.record(z.string().min(1), ConnectorHubSchema),
    capabilities: z.record(z.string().min(1), ConnectorCapabilitySchema),
  })
  .strict();
export type ConnectorsRegistry = z.infer<typeof ConnectorsRegistrySchema>;

export const ConnectorsRegistryJsonSchema = zodToJsonSchema(ConnectorsRegistrySchema, {
  name: "ConnectorsRegistry",
  $refStrategy: "none",
  target: "jsonSchema7",
});
