import { ValidationError } from "@buntime/shared/errors";
import type { Context } from "hono";

const MULTIPART_FORM_DATA = "multipart/form-data";

export async function readUploadFile(ctx: Context): Promise<File> {
  const contentType = ctx.req.header("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith(MULTIPART_FORM_DATA)) {
    throw new ValidationError("Expected multipart/form-data upload", "INVALID_MULTIPART_FORM");
  }

  let formData: FormData;

  try {
    formData = await ctx.req.formData();
  } catch {
    throw new ValidationError("Invalid multipart form data", "INVALID_MULTIPART_FORM");
  }

  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new ValidationError("No file provided", "NO_FILE_PROVIDED");
  }

  return file;
}
