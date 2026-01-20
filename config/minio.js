// config/minio.js
import { Client } from "minio";

/**
 * Parse the MINIO_ENDPOINT from .env
 * Supports either:
 *   MINIO_ENDPOINT=https://host:9000
 *   MINIO_ENDPOINT=host   (with MINIO_PORT set separately)
 */
function parseMinioEndpoint(endpoint) {
  const ep = String(endpoint || "").trim();
  if (!ep) throw new Error("MINIO_ENDPOINT missing in .env");

  // Case 1: full URL with protocol
  if (ep.startsWith("http://") || ep.startsWith("https://")) {
    const u = new URL(ep);
    return {
      endPoint: u.hostname,
      port: Number(u.port || 9000),
      useSSL: u.protocol === "https:",
    };
  }

  // Case 2: just hostname, rely on MINIO_PORT + MINIO_USE_SSL
  return {
    endPoint: ep,
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: String(process.env.MINIO_USE_SSL || "false").toLowerCase() === "true",
  };
}

const { endPoint, port, useSSL } = parseMinioEndpoint(process.env.MINIO_ENDPOINT);

export const MINIO_BUCKET = process.env.MINIO_BUCKET;

export const minioClient = new Client({
  endPoint,
  port,
  useSSL,
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});
