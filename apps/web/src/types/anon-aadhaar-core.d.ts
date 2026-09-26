// The package's "types" entry is its raw TypeScript source, which doesn't pass our strict
// settings. This declares only the part of the API Townsquare uses; tsconfig maps the import here.
export type FieldsToRevealArray = ("revealAgeAbove18" | "revealGender" | "revealPinCode" | "revealState")[];

export enum ArtifactsOrigin {
  server = 0,
  local = 1,
  chunked = 2,
}

export const artifactUrls: { v2: { wasm: string; zkey: string; vk: string; chunked: string } };

export function generateArgs(opts: {
  qrData: string;
  certificateFile: string;
  nullifierSeed: number | bigint;
  fieldsToRevealArray?: FieldsToRevealArray;
  signal?: string;
}): Promise<unknown>;

export function init(args: { wasmURL: string; zkeyURL: string; vkeyURL: string; artifactsOrigin: ArtifactsOrigin }): Promise<void>;

export function prove(args: unknown, updateState?: (state: string) => void): Promise<{ proof: Record<string, unknown> }>;
