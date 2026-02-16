/**
* One-time script to configure CORS on the R2 bucket.
* Run: node setup-cors.js
*/
require('dotenv').config();
const { S3Client, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

async function setupCors() {
    const command = new PutBucketCorsCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        CORSConfiguration: {
            CORSRules: [
                {
                    AllowedOrigins: ['*'],
                    AllowedMethods: ['GET', 'PUT', 'HEAD'],
                    AllowedHeaders: ['*'],
                    ExposeHeaders: ['ETag', 'Content-Length'],
                    MaxAgeSeconds: 3600,
                },
            ],
        },
    });

    try {
        await s3.send(command);
        console.log('✅ CORS configuration applied successfully to bucket:', process.env.R2_BUCKET_NAME);
    } catch (error) {
        console.error('❌ Failed to set CORS:', error.message);
        process.exit(1);
    }
}

setupCors();
