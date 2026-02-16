const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;

/**
 * Generate a presigned PUT URL for direct client upload to R2.
 * @param {string} key - Object key (e.g. "video.mp4")
 * @param {string} contentType - MIME type
 * @param {number} expiresIn - URL expiry in seconds (default 1 hour)
 */
async function getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * List all objects in the bucket.
 */
async function listObjects() {
  const command = new ListObjectsV2Command({ Bucket: BUCKET });
  const response = await s3.send(command);
  return response.Contents || [];
}

/**
 * Delete an object from the bucket.
 * @param {string} key - Object key to delete
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await s3.send(command);
}

module.exports = { getPresignedUploadUrl, listObjects, deleteObject };
