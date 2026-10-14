export interface ImportDocument { id: string; data: Record<string, unknown>; updateTime: string }
type FirestoreValue = Record<string, unknown>;
export function decodeFields(fields: Record<string, FirestoreValue> = {}): Record<string, unknown> {
  const decode = (value: FirestoreValue): unknown => {
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return value.doubleValue;
    if ("booleanValue" in value) return value.booleanValue;
    if ("nullValue" in value) return null;
    if ("timestampValue" in value) return value.timestampValue;
    if (value.mapValue) return decodeFields((value.mapValue as { fields?: Record<string, FirestoreValue> }).fields);
    if (value.arrayValue) return ((value.arrayValue as { values?: FirestoreValue[] }).values ?? []).map(decode);
    throw Error("Kiểu dữ liệu Firestore không hỗ trợ trong importer.");
  };
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]));
}
export function encodeFields(data: Record<string, unknown>): Record<string, FirestoreValue> {
  const encode = (value: unknown): FirestoreValue => {
    if (value === null) return { nullValue: null };
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "boolean") return { booleanValue: value };
    if (typeof value === "number" && Number.isFinite(value)) return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
    if (value && typeof value === "object") return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
    throw Error("Giá trị không hợp lệ khi nhập Firestore.");
  };
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]));
}
export class ImportFirestore {
  readonly root: string;
  reads = 0;
  writes = 0;
  constructor(readonly project: string, private readonly token: () => Promise<string>) {
    if (!/^[a-z0-9-]+$/.test(project)) throw Error("Project không hợp lệ.");
    this.root = `projects/${project}/databases/(default)/documents`;
  }
  async request(path: string, method: "GET" | "POST", body?: object, missingAllowed = false): Promise<unknown> {
    const response = await fetch(`https://firestore.googleapis.com/v1/${this.root}${path}`, {
      method, headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000),
    });
    if (missingAllowed && response.status === 404) return null;
    const data = await response.json() as { error?: { status?: string } };
    if (!response.ok) throw new ImportFirestoreError(response.status, data.error?.status ?? "Lỗi Firestore");
    return data;
  }
  async get(collection: string, id: string): Promise<ImportDocument | null> {
    this.reads++;
    const raw = await this.request(`/${collection}/${id}`, "GET", undefined, true) as { fields: Record<string, FirestoreValue>; updateTime: string } | null;
    return raw ? { id, data: decodeFields(raw.fields), updateTime: raw.updateTime } : null;
  }
  async members(collection: string, shopId: number): Promise<ImportDocument[]> {
    const raw = await this.request(":runQuery", "POST", { structuredQuery: {
      from: [{ collectionId: collection }], where: { fieldFilter: { field: { fieldPath: "shopId" }, op: "EQUAL", value: { integerValue: String(shopId) } } },
    } }) as { document?: { name: string; fields: Record<string, FirestoreValue>; updateTime: string } }[];
    const docs = raw.filter(row => row.document).map(({ document: doc }) => ({ id: doc!.name.split("/").pop()!, data: decodeFields(doc!.fields), updateTime: doc!.updateTime }));
    this.reads += Math.max(1, docs.length);
    return docs;
  }
  write(collection: string, id: string, patch: Record<string, unknown>, previous: ImportDocument | null) {
    return { update: { name: `${this.root}/${collection}/${id}`, fields: encodeFields(patch) },
      ...(previous ? { updateMask: { fieldPaths: Object.keys(patch) } } : {}),
      currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } };
  }
  async commit(writes: object[]): Promise<string[]> {
    if (!writes.length) return [];
    const response = await this.request(":commit", "POST", { writes }) as { writeResults: { updateTime: string }[] };
    this.writes += writes.length;
    return response.writeResults.map(result => result.updateTime);
  }
}
export class ImportFirestoreError extends Error {
  constructor(readonly status: number, message: string) { super(`Firestore HTTP ${status}: ${message}`); }
}
