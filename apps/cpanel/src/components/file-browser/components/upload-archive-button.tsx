import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Icon } from "~/components/ui/icon";

interface UploadArchiveButtonProps {
  /**
   * Server-side install handler. Receives a single archive `File` and returns
   * the runtime response. Typically `uploadWorker` or `uploadPlugin` from
   * `admin-api.ts`, which know how to extract the archive at the right place.
   */
  onUpload: (file: File) => Promise<{ success?: boolean }>;
  /** Toast message on success. */
  successMessage?: string;
  /** Toast message on error. */
  errorMessage?: string;
  /** Optional callback fired after a successful upload (e.g. invalidate queries). */
  onSuccess?: () => void;
  /** Accept filter for the file picker. Defaults to common archive extensions. */
  accept?: string;
  /** Visible label. */
  label: string;
}

/**
 * Header-row "install" button: opens a file picker for an archive (.zip /
 * .tgz / .tar.gz) and hands it to the supplied `onUpload` handler. Use this
 * for the **primary** install action in the Workers/Plugins tabs — it
 * bypasses the FS path policy by going through the dedicated install
 * endpoints (`/api/workers/upload`, `/api/plugins/upload`), which know how to
 * unpack the archive at the proper location.
 */
export function UploadArchiveButton({
  accept = ".zip,.tgz,.tar.gz,application/zip,application/gzip,application/x-gzip",
  errorMessage = "Upload failed",
  label,
  onSuccess,
  onUpload,
  successMessage = "Uploaded",
}: UploadArchiveButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (evt: React.ChangeEvent<HTMLInputElement>) => {
    const file = evt.target.files?.[0];
    evt.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const res = await onUpload(file);
      if (res.success === false) throw new Error(errorMessage);
      toast.success(successMessage);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : errorMessage);
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Button
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Icon
          className={uploading ? "size-4 animate-spin" : "size-4"}
          icon={uploading ? "lucide:loader-2" : "lucide:file-up"}
        />
        {label}
      </Button>
      <input
        accept={accept}
        className="hidden"
        onChange={handleChange}
        ref={inputRef}
        type="file"
      />
    </>
  );
}
