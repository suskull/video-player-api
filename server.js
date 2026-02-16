require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { getPresignedUploadUrl, listObjects, deleteObject, uploadFile } = require('./r2');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
    origin: [
        (process.env.FRONTEND_URL || '').replace(/\/+$/, ''),
        'http://localhost:5173',
    ].filter(Boolean),
    methods: ['GET', 'POST', 'DELETE'],
}));
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

/**
 * GET /api/video
 * Returns info about the currently uploaded video (if any).
 */
app.get('/api/video', async (req, res) => {
    try {
        const objects = await listObjects();
        const videoObj = objects.find(obj =>
            obj.Key.startsWith('video.')
        );
        const subtitleObj = objects.find(obj =>
            obj.Key.startsWith('subtitle.')
        );

        if (!videoObj) {
            return res.json({ video: null });
        }

        const publicUrl = process.env.R2_PUBLIC_URL;

        res.json({
            video: {
                key: videoObj.Key,
                url: `${publicUrl}/${videoObj.Key}`,
                size: videoObj.Size,
                lastModified: videoObj.LastModified,
            },
            subtitle: subtitleObj ? {
                key: subtitleObj.Key,
                url: `${publicUrl}/${subtitleObj.Key}`,
            } : null,
        });
    } catch (error) {
        console.error('Error listing video:', error);
        res.status(500).json({ error: 'Failed to get video info' });
    }
});

/**
 * POST /api/upload-url
 * Generates a presigned PUT URL for direct upload to R2.
 * Body: { fileName: string, fileType: string, category: "video" | "subtitle" }
 */
app.post('/api/upload-url', async (req, res) => {
    try {
        const { fileName, fileType, category } = req.body;

        if (!fileName || !fileType || !category) {
            return res.status(400).json({ error: 'Missing fileName, fileType, or category' });
        }

        if (!['video', 'subtitle'].includes(category)) {
            return res.status(400).json({ error: 'Category must be "video" or "subtitle"' });
        }

        // Use a fixed key pattern: video.{ext} or subtitle.{ext}
        const ext = fileName.split('.').pop().toLowerCase();
        const key = `${category}.${ext}`;

        const uploadUrl = await getPresignedUploadUrl(key, fileType, 7200); // 2 hour expiry for large files

        res.json({ uploadUrl, key });
    } catch (error) {
        console.error('Error generating upload URL:', error);
        res.status(500).json({ error: 'Failed to generate upload URL' });
    }
});

/**
 * DELETE /api/video
 * Deletes all video and subtitle files from R2.
 */
app.delete('/api/video', async (req, res) => {
    try {
        const objects = await listObjects();

        const deletePromises = objects.map(obj => deleteObject(obj.Key));
        await Promise.all(deletePromises);

        res.json({ message: 'All files deleted' });
    } catch (error) {
        console.error('Error deleting files:', error);
        res.status(500).json({ error: 'Failed to delete files' });
    }
});

/**
 * POST /api/transcode
 * Downloads the current video from R2, transcodes audio to AAC using FFmpeg,
 * uploads the result back to R2, and deletes the original.
 */
app.post('/api/transcode', async (req, res) => {
    const tmpDir = os.tmpdir();
    let inputPath = null;
    let outputPath = null;

    try {
        // 1. Find the current video in R2
        const objects = await listObjects();
        const videoObj = objects.find(obj => obj.Key.startsWith('video.'));

        if (!videoObj) {
            return res.status(404).json({ error: 'No video found to transcode' });
        }

        const ext = videoObj.Key.split('.').pop().toLowerCase();
        const publicUrl = process.env.R2_PUBLIC_URL;
        const videoUrl = `${publicUrl}/${videoObj.Key}`;

        inputPath = path.join(tmpDir, `input_${Date.now()}.${ext}`);
        outputPath = path.join(tmpDir, `output_${Date.now()}.mp4`);

        console.log(`[transcode] Downloading ${videoUrl}...`);

        // 2. Download video from R2 public URL
        await new Promise((resolve, reject) => {
            const mod = videoUrl.startsWith('https') ? https : http;
            const file = fs.createWriteStream(inputPath);
            mod.get(videoUrl, (response) => {
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    // Follow redirect
                    mod.get(response.headers.location, (r2) => {
                        r2.pipe(file);
                        file.on('finish', () => file.close(resolve));
                    }).on('error', reject);
                } else {
                    response.pipe(file);
                    file.on('finish', () => file.close(resolve));
                }
            }).on('error', reject);
        });

        console.log(`[transcode] Downloaded to ${inputPath}`);
        console.log(`[transcode] Starting FFmpeg transcode...`);

        // 3. Run FFmpeg: copy video stream, transcode audio to AAC
        await new Promise((resolve, reject) => {
            const args = [
                '-i', inputPath,
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-y',
                outputPath,
            ];
            const proc = execFile('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 }, (error) => {
                if (error) reject(error);
                else resolve();
            });
            proc.stderr.on('data', (data) => {
                // Log FFmpeg progress
                const line = data.toString().trim();
                if (line.includes('time=')) console.log(`[ffmpeg] ${line}`);
            });
        });

        console.log(`[transcode] FFmpeg done. Uploading transcoded file...`);

        // 4. Upload transcoded MP4 back to R2
        await uploadFile('video.mp4', outputPath, 'video/mp4');

        console.log(`[transcode] Uploaded video.mp4 to R2`);

        // 5. Delete original if it was not already video.mp4
        if (videoObj.Key !== 'video.mp4') {
            await deleteObject(videoObj.Key);
            console.log(`[transcode] Deleted original ${videoObj.Key}`);
        }

        res.json({ success: true, message: 'Transcoding complete', key: 'video.mp4' });
    } catch (error) {
        console.error('[transcode] Error:', error);
        res.status(500).json({ error: error.message || 'Transcoding failed' });
    } finally {
        // Clean up temp files
        if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
