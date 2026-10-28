"use client";

import { useActionState, useState, type ChangeEvent, type FormEvent } from "react";
import { uploadMediaAction } from "@/app/actions/media";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkMediaFile, MEDIA_EXTENSIONS_FOR_PICKER } from "@/lib/media/files";
import { MEDIA_ALT_TEXT_MAX_LENGTH } from "@/lib/media/limits";
import { SIGNATURE_BYTES } from "@/lib/media/signatures";

// "Upload" on the media page (step 39). The file is checked in the browser
// first, with the same rules the server applies again (lib/media/files.ts:
// its name, its size and its own first bytes): a file over the limit never
// gets sent, because the hosting platform would cut the request off (Vercel
// at 4.5 MB) before our server could answer, and a PNG named .jpg, a
// script named .png or an SVG is refused at once.
export function MediaUploadForm() {
  const [state, action, isUploading] = useActionState(uploadMediaAction, undefined);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  // The server's last answer is about the file that was sent. Once another
  // file is chosen, or while a new upload runs, its messages no longer
  // apply; what was typed still does (see the alt text's defaultValue).
  const [choseAnotherFile, setChoseAnotherFile] = useState(false);
  const serverErrors = choseAnotherFile || isUploading ? undefined : state?.errors;
  const message = fileProblem ?? serverErrors?.message;
  const altTextError = serverErrors?.fieldErrors?.altText?.[0];

  async function checkChosenFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    setChoseAnotherFile(true);
    if (!file) {
      setFileProblem(null);
      return;
    }
    setIsChecking(true);
    setFileProblem(await problemWith(file));
    setIsChecking(false);
  }

  function stopBadFile(event: FormEvent<HTMLFormElement>) {
    if (isChecking || fileProblem) {
      // Nothing is sent: React runs the form's action only when this didn't.
      event.preventDefault();
      return;
    }
    // This file is being sent: the answer to show is the one about it.
    setChoseAnotherFile(false);
  }

  return (
    <form action={action} onSubmit={stopBadFile} className="grid max-w-2xl gap-3">
      <div className="grid gap-2">
        <Label htmlFor="media-file">An image (PNG, JPEG, WebP or GIF) or an MP4 video, up to 4 MB</Label>
        <Input
          id="media-file"
          name="file"
          type="file"
          required
          accept={MEDIA_EXTENSIONS_FOR_PICKER}
          onChange={checkChosenFile}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? "media-file-error" : undefined}
          className="w-full max-w-96"
        />
        {message && (
          <p id="media-file-error" role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="media-alt-text">What it shows (optional, for people who can&apos;t see it)</Label>
        <Input
          id="media-alt-text"
          name="altText"
          autoComplete="off"
          maxLength={MEDIA_ALT_TEXT_MAX_LENGTH}
          // From the action's own state, never from the messages hidden once
          // another file is chosen: after a refusal the file must be chosen
          // again (a file box can't be refilled), and a default turning ""
          // at that moment would empty the box the reset refilled.
          defaultValue={state?.errors?.values?.altText ?? ""}
          aria-invalid={altTextError ? true : undefined}
          aria-describedby={altTextError ? "media-alt-text-error" : undefined}
        />
        {altTextError && (
          <p id="media-alt-text-error" role="alert" className="text-sm text-destructive">
            {altTextError}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isUploading || isChecking}>
          {isUploading ? "Uploading..." : "Upload"}
        </Button>
        <span role="status" className="text-sm text-muted-foreground">
          {state?.saved === true && !isUploading && !choseAnotherFile ? "Uploaded." : ""}
        </span>
      </div>
    </form>
  );
}

// The page's words for why this file can't be uploaded, or null.
async function problemWith(file: File): Promise<string | null> {
  const firstBytes = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const checked = checkMediaFile(file, firstBytes);
  return checked.ok ? null : checked.message;
}
