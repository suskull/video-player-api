require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { getPresignedUploadUrl, listObjects, deleteObject } = require('./r2');

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

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
