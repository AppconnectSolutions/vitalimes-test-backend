// utils/getImageUrl.js

export function getImageUrl(minioUrl) {
  try {
    // Extract the filename from full MinIO URL
    const parts = minioUrl.split("/");
    const filename = parts[parts.length - 1];

    // Encode it to handle spaces/special characters
    const encodedFilename = encodeURIComponent(filename);

    // Return your Express proxy URL
    return `http://localhost:5000/images/${encodedFilename}`;
  } catch (err) {
    console.error("Invalid MinIO URL:", minioUrl);
    return "";
  }
}
