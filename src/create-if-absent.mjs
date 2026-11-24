import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";

/**
 * Atomically creates path with text only if it is absent. Returns true when created, false when
 * a file already occupies path (in place of the retired flatfile package's createFlatfile, which
 * hard-linked a finished temporary file into an absent destination for the same guarantee).
 */
export async function createIfAbsent(path, text, mode) {
  try {
    await writeFileText(path, text, { flag: "wx", mode });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return false;
  }
}
