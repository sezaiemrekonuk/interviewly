/**
 * K9 prompt registry. Loads every `prompts/*.prompt.yaml` and keys them by
 * `(name, version)`; `resolve(name)` without a version returns the highest version.
 *
 * The `uuid` is the permanent identity that cost and quality hang off. It is stable ACROSS
 * versions of one lineage — `interview.report.generate` v1 and v2 share a uuid — so the
 * duplicate check is "one uuid, one name", not "one uuid, one file". Two different lineages
 * sharing a uuid would silently merge their cost history, so that throws at load.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export const PROMPTS_DIR = join(__dirname, '..', 'prompts');

const PromptFileSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string().min(1),
  version: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user']),
        content: z.string().min(1),
      }),
    )
    .min(1),
});

export type PromptFile = z.infer<typeof PromptFileSchema>;

export class PromptRegistry {
  private readonly byKey = new Map<string, PromptFile>();

  constructor(files: PromptFile[]) {
    const nameByUuid = new Map<string, string>();
    for (const file of files) {
      const key = `${file.name}@${file.version}`;
      if (this.byKey.has(key)) {
        throw new Error(`duplicate prompt ${key}`);
      }
      const claimed = nameByUuid.get(file.uuid);
      if (claimed !== undefined && claimed !== file.name) {
        throw new Error(`prompt uuid ${file.uuid} is used by both "${claimed}" and "${file.name}"`);
      }
      nameByUuid.set(file.uuid, file.name);
      this.byKey.set(key, file);
    }
  }

  /** Every provider named by a loaded prompt — B7 validates a key exists for each. */
  providers(): string[] {
    return [...new Set([...this.byKey.values()].map((f) => f.provider))].sort();
  }

  names(): string[] {
    return [...new Set([...this.byKey.values()].map((f) => f.name))].sort();
  }

  resolve(name: string, version?: number): PromptFile {
    if (version !== undefined) {
      const exact = this.byKey.get(`${name}@${version}`);
      if (!exact) throw new Error(`no prompt ${name}@${version}`);
      return exact;
    }
    const versions = [...this.byKey.values()]
      .filter((f) => f.name === name)
      .sort((a, b) => b.version - a.version);
    if (versions.length === 0) throw new Error(`no prompt named ${name}`);
    return versions[0];
  }
}

export function loadPromptRegistry(dir: string = PROMPTS_DIR): PromptRegistry {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.prompt.yaml'))
    .sort()
    .map((f) => PromptFileSchema.parse(parse(readFileSync(join(dir, f), 'utf8'))));
  return new PromptRegistry(files);
}
