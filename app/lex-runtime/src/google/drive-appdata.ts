import { GoogleOAuthError, type FetchLike } from "./oauth.js";

// Minimal client for the hidden Drive app folder (scope drive.appdata). The
// app can see only files it created there, never the user's own files.
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

export async function createAppDataFile(args: {
  fetch: FetchLike;
  accessToken: string;
  name: string;
  content: string;
}): Promise<string> {
  const boundary = "lex" + Date.now().toString(36);
  const body =
    `--${boundary}\r\n` +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify({
      name: args.name,
      parents: ["appDataFolder"]
    }) +
    `\r\n--${boundary}\r\n` +
    "Content-Type: application/json\r\n\r\n" +
    args.content +
    `\r\n--${boundary}--`;
  const response = await args
    .fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${args.accessToken}`,
        "content-type": `multipart/related; boundary=${boundary}`
      },
      body
    })
    .catch(() => {
      throw new GoogleOAuthError("GOOGLE_DRIVE_NETWORK_ERROR");
    });
  if (!response.ok) {
    throw new GoogleOAuthError("GOOGLE_DRIVE_WRITE_FAILED");
  }
  const json = (await response.json()) as { id?: unknown };
  if (typeof json.id !== "string" || !json.id) {
    throw new GoogleOAuthError("GOOGLE_DRIVE_WRITE_FAILED");
  }
  return json.id;
}

export async function readAppDataFile(args: {
  fetch: FetchLike;
  accessToken: string;
  fileId: string;
}): Promise<string> {
  const response = await args
    .fetch(
      `${FILES_URL}/${encodeURIComponent(args.fileId)}?alt=media`,
      {
        headers: {
          authorization: `Bearer ${args.accessToken}`
        }
      }
    )
    .catch(() => {
      throw new GoogleOAuthError("GOOGLE_DRIVE_NETWORK_ERROR");
    });
  if (!response.ok) {
    throw new GoogleOAuthError("GOOGLE_DRIVE_READ_FAILED");
  }
  return await response.text();
}

export async function deleteAppDataFile(args: {
  fetch: FetchLike;
  accessToken: string;
  fileId: string;
}): Promise<boolean> {
  try {
    const response = await args.fetch(
      `${FILES_URL}/${encodeURIComponent(args.fileId)}`,
      {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${args.accessToken}`
        }
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}
