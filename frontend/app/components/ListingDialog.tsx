"use client";
import { FormEvent, useState } from "react";
import { imageUrl } from "../lib/api";
import {
  checkImages,
  IMAGE_TYPES,
  listingBody,
  MAX_IMAGES,
} from "../lib/format";
import { FEATURES, type ListingBody, type Space } from "../lib/types";
import { Alert, Modal } from "./Modal";

export function ListingDialog({
  space,
  busy,
  error,
  save,
  removeImage,
  close,
}: {
  space?: Space;
  busy: boolean;
  error: string;
  save: (body: ListingBody, files: File[]) => void;
  removeImage?: (imageId: string) => void;
  close: () => void;
}) {
  const [problem, setProblem] = useState("");
  const existing = space?.image_ids ?? [];
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const picker = event.currentTarget.elements.namedItem(
      "photos",
    ) as HTMLInputElement | null;
    const files = Array.from(picker?.files ?? []);
    try {
      const imageProblem = checkImages(files, existing.length);
      if (imageProblem) throw new Error(imageProblem);
      const body = listingBody(data);
      setProblem("");
      save(body, files);
    } catch (e) {
      setProblem((e as Error).message);
    }
  }
  return (
    <Modal
      title={space ? "Edit parking space" : "List a parking space"}
      close={close}
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        <label>
          Space name
          <input
            name="title"
            minLength={3}
            maxLength={120}
            required
            defaultValue={space?.title}
            placeholder="e.g. River North covered space"
          />
        </label>
        <label>
          Address
          <input
            name="address"
            minLength={3}
            maxLength={250}
            required
            defaultValue={space?.address}
            placeholder="Fictional demo address"
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={2000}
            rows={3}
            defaultValue={space?.description}
            placeholder="Access instructions, clearance, nearby landmarks"
          />
        </label>
        <div className="two-columns">
          <label>
            Latitude
            <input
              name="latitude"
              type="number"
              step="any"
              min="-90"
              max="90"
              required
              defaultValue={space?.latitude ?? "41.88"}
            />
          </label>
          <label>
            Longitude
            <input
              name="longitude"
              type="number"
              step="any"
              min="-180"
              max="180"
              required
              defaultValue={space?.longitude ?? "-87.63"}
            />
          </label>
        </div>
        <label>
          Hourly price (USD)
          <input
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            max="1000"
            defaultValue={
              space ? (space.hourly_price_cents / 100).toFixed(2) : "4.00"
            }
            required
          />
        </label>
        <fieldset className="feature-chips">
          <legend>Features</legend>
          {FEATURES.map(([key, label]) => (
            <label key={key} className="chip">
              <input
                type="checkbox"
                name="features"
                value={key}
                defaultChecked={space?.features?.includes(key)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {space && existing.length > 0 && (
          <div className="gallery editable" aria-label="Current photos">
            {existing.map((id, i) => (
              <figure key={id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl(space.id, id)} alt={`Photo ${i + 1}`} />
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  onClick={() => removeImage?.(id)}
                >
                  Remove photo {i + 1}
                </button>
              </figure>
            ))}
          </div>
        )}
        {existing.length < MAX_IMAGES && (
          <label>
            Add photos
            <input
              name="photos"
              type="file"
              multiple
              accept={IMAGE_TYPES.join(",")}
            />
          </label>
        )}
        <p className="field-note">
          JPEG, PNG or WebP, up to 2 MB each and {MAX_IMAGES} per space.
          Listings are available around the clock until paused. Add fictional
          locations only.
        </p>
        <Alert error={problem || error} />
        <button className="button dark full" disabled={busy}>
          {busy ? "Saving…" : space ? "Save changes" : "Publish demo listing"}
        </button>
      </form>
    </Modal>
  );
}
