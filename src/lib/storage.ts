// Object storage (Cloudflare R2, EU) — the seam between the app and binary evidence bytes (#105).
//
// Binary evidence lives in R2 (spine item 7, §10.5), never in Postgres and never proxied through the
// app: clients PUT directly to R2 via a short-lived presigned URL, and downloads are short-lived
// presigned GETs (#107). This module owns the S3-compatible client (R2 speaks the S3 API) and a small
// ObjectStore interface so the domain (createUpload #105, finalize #106, signed view #107) never
// touches aws4fetch directly — and so tests run against an in-memory store with no live R2 (mirroring
// the embedded-postgres philosophy).
import { AwsClient } from "aws4fetch";

export interface PresignedUrl {
  /** The signed URL the client uses directly (PUT to upload, GET to download). */
  url: string;
  /** TTL in seconds after which the signature expires. */
  expiresIn: number;
}

/** Minimal object-store surface used across M3. Real impl = R2; tests use the in-memory impl. */
export interface ObjectStore {
  readonly bucket: string;
  /** Presign a direct-to-store PUT (client uploads the bytes). */
  presignPut(key: string, opts: { contentType: string; expiresIn?: number }): Promise<PresignedUrl>;
  /** Presign a short-lived GET (client downloads/views). */
  presignGet(key: string, opts?: { expiresIn?: number }): Promise<PresignedUrl>;
  /** Fetch the stored bytes (finalize #106 reads them to validate + checksum). Null if absent. */
  getObject(key: string): Promise<Uint8Array | null>;
  /** Write bytes (finalize #106 re-puts the sanitized object; tests seed objects). */
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Object size in bytes, or null if the object does not exist. */
  headObject(key: string): Promise<{ size: number } | null>;
}

const DEFAULT_PUT_TTL = 60; // §22: upload PUT URLs <= 60s — bounds the window a leaked/stale PUT is usable.
const DEFAULT_GET_TTL = 300; // §10.5 / §22: view URLs are <= 5 min.

/** Cloudflare R2 (S3-compatible) object store, signed with aws4fetch (zero-dep SigV4). */
export class R2ObjectStore implements ObjectStore {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  constructor(
    public readonly bucket: string,
    opts: { endpoint: string; accessKeyId: string; secretAccessKey: string },
  ) {
    this.endpoint = opts.endpoint.replace(/\/$/, "");
    this.client = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      region: "auto",
      service: "s3",
    });
  }

  private objectUrl(key: string): URL {
    // key segments are id-only (§10.5) but still encode each path segment defensively.
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return new URL(`${this.endpoint}/${this.bucket}/${encoded}`);
  }

  async presignPut(
    key: string,
    opts: { contentType: string; expiresIn?: number },
  ): Promise<PresignedUrl> {
    const expiresIn = opts.expiresIn ?? DEFAULT_PUT_TTL;
    const url = this.objectUrl(key);
    url.searchParams.set("X-Amz-Expires", String(expiresIn));
    const signed = await this.client.sign(
      new Request(url, { method: "PUT", headers: { "content-type": opts.contentType } }),
      { aws: { signQuery: true } },
    );
    return { url: signed.url, expiresIn };
  }

  async presignGet(key: string, opts?: { expiresIn?: number }): Promise<PresignedUrl> {
    const expiresIn = opts?.expiresIn ?? DEFAULT_GET_TTL;
    const url = this.objectUrl(key);
    url.searchParams.set("X-Amz-Expires", String(expiresIn));
    // Force a download disposition so a signed link never renders inline in a browser tab (§22).
    url.searchParams.set("response-content-disposition", "attachment");
    const signed = await this.client.sign(new Request(url, { method: "GET" }), {
      aws: { signQuery: true },
    });
    return { url: signed.url, expiresIn };
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const res = await this.client.fetch(new Request(this.objectUrl(key), { method: "GET" }));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 getObject failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const res = await this.client.fetch(
      new Request(this.objectUrl(key), {
        method: "PUT",
        headers: { "content-type": contentType },
        // Wrap in a Blob (a BodyInit) to avoid the Uint8Array<ArrayBufferLike> vs BodyInit typing gap.
        body: new Blob([body as BlobPart], { type: contentType }),
      }),
    );
    if (!res.ok) throw new Error(`R2 putObject failed: ${res.status}`);
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const res = await this.client.fetch(new Request(this.objectUrl(key), { method: "HEAD" }));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 headObject failed: ${res.status}`);
    const len = res.headers.get("content-length");
    return { size: len ? Number(len) : 0 };
  }
}

/** In-memory ObjectStore for tests (no live R2). Presigned URLs are opaque, expiry-tagged fakes. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  constructor(public readonly bucket = "shift-ledger-test") {}

  private fakeUrl(key: string, method: string, expiresIn: number): string {
    const u = new URL(`https://memory.local/${this.bucket}/${key}`);
    u.searchParams.set("X-Amz-Method", method);
    u.searchParams.set("X-Amz-Expires", String(expiresIn));
    u.searchParams.set("X-Amz-Signature", "test-signature");
    return u.toString();
  }

  async presignPut(
    key: string,
    opts: { contentType: string; expiresIn?: number },
  ): Promise<PresignedUrl> {
    const expiresIn = opts.expiresIn ?? DEFAULT_PUT_TTL;
    return { url: this.fakeUrl(key, "PUT", expiresIn), expiresIn };
  }
  async presignGet(key: string, opts?: { expiresIn?: number }): Promise<PresignedUrl> {
    const expiresIn = opts?.expiresIn ?? DEFAULT_GET_TTL;
    return { url: this.fakeUrl(key, "GET", expiresIn), expiresIn };
  }
  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.body ?? null;
  }
  async putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }
  async headObject(key: string): Promise<{ size: number } | null> {
    const o = this.objects.get(key);
    return o ? { size: o.body.byteLength } : null;
  }
}

let cached: ObjectStore | undefined;

/**
 * Resolve the configured R2 store from env. Fails CLOSED: if the R2 credentials are absent it throws
 * rather than silently degrading (there is no "local disk" evidence store — bytes belong in R2, EU).
 * Tests do NOT call this; they construct an InMemoryObjectStore and pass it in explicitly.
 */
export function getObjectStore(): ObjectStore {
  if (cached) return cached;
  const bucket = process.env.R2_BUCKET;
  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2 storage is not configured (R2_BUCKET/R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY).",
    );
  }
  cached = new R2ObjectStore(bucket, { endpoint, accessKeyId, secretAccessKey });
  return cached;
}
