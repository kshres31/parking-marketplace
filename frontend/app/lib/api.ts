import { errorMessage } from "./format";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Browser-Session": "1",
      ...init?.headers,
    },
  });
  if (!response.ok)
    throw new Error(errorMessage(await response.json().catch(() => ({}))));
  return response.status === 204 ? (undefined as T) : response.json();
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const imageUrl = (listingId: string, imageId: string) =>
  `/listings/${listingId}/images/${imageId}`;

export async function uploadImages(listingId: string, files: File[]) {
  // Sequential uploads keep the server's per-listing limit check predictable.
  for (const file of files)
    await api(`/listings/${listingId}/images`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": file.type },
    });
}
