import { z } from 'zod';
import { HTTP_METHODS } from '../../shared/types';

export const KeyValueSchema = z.object({
  id: z.string().min(1),
  key: z.string(),
  value: z.string(),
  enabled: z.boolean(),
});

export const AuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('bearer'), token: z.string() }),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }),
  z.object({ type: z.literal('apikey'), key: z.string(), value: z.string(), in: z.enum(['header', 'query']) }),
]);

export const BodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('json'), text: z.string() }),
  z.object({ mode: z.literal('text'), text: z.string() }),
  z.object({ mode: z.literal('urlencoded'), fields: z.array(KeyValueSchema) }),
]);

export const MethodSchema = z.enum(HTTP_METHODS);

export const ApiRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  method: MethodSchema,
  url: z.string(),
  params: z.array(KeyValueSchema),
  headers: z.array(KeyValueSchema),
  auth: AuthSchema,
  body: BodySchema,
});

const name = z.string().trim().min(1, 'Name is required').max(200);

/** Incoming collection: the server owns `updatedAt`, so clients may omit it. */
export const CollectionInputSchema = z.object({
  id: z.string().min(1),
  name,
  requests: z.array(ApiRequestSchema),
  updatedAt: z.string().optional(),
});

export const EnvironmentSchema = z.object({
  id: z.string().min(1),
  name,
  variables: z.array(KeyValueSchema),
});

export const WorkspaceSchema = z.object({
  collections: z.array(CollectionInputSchema.extend({ updatedAt: z.string() })),
  environments: z.array(EnvironmentSchema),
});

export const CreateNamedSchema = z.object({ name });

export const CreateEnvironmentSchema = z.object({
  name,
  variables: z.array(KeyValueSchema).default([]),
});

export const ProxyRequestSchema = z.object({
  method: MethodSchema,
  url: z.string().trim().min(1, 'URL is required'),
  headers: z.array(z.tuple([z.string(), z.string()])).default([]),
  body: z.string().optional(),
  timeoutMs: z.number().int().min(1).max(300_000).optional(),
});
