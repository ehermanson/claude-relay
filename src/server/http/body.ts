import http from "node:http";

export function readJsonBody<T>(req: http.IncomingMessage, maxBody = 1024 * 10): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
