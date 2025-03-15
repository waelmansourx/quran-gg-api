# Quran API JS

A Node.js API for generating Quran videos with Arabic text, translation, and recitation.

## Features

- Generate vertical videos for social media (TikTok, Reels, Shorts)
- Add Arabic Quran text and translations
- Include recitation audio synchronized with text
- Upload videos to R2 storage
- Get presigned URLs for accessing videos

## Prerequisites

- Node.js (v18 or higher)
- FFmpeg installed on your system
- Cloudflare R2 account (or other compatible S3 storage)

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/quran-api-js.git
   cd quran-api-js
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Set up your environment variables:
   ```
   R2_ACCOUNT_ID=your_cloudflare_account_id
   R2_ACCESS_KEY_ID=your_r2_access_key
   R2_SECRET_ACCESS_KEY=your_r2_secret_key
   R2_BUCKET_NAME=your_bucket_name
   ```

4. Add required font files to the `static/fonts` directory:
   - UthmanicHafs1Ver13.otf - For Arabic text
   - ClashDisplay-Regular.otf - For translation text

5. Add images to `static/images`:
   - quran-watermark.png - Watermark for videos

6. Add the background gradient to `static`:
   - bg-vid-gradient.png - Overlay gradient for videos

## Running the Server

```
npm start
```

For development with automatic restart:
```
npm run dev
```

## API Endpoints

### 1. Process Video Request

**Endpoint:** `POST /process`

**Request Body:**
```json
{
  "recitation_files": [
    {
      "audio_files": [
        {
          "url": "audio/path/file1.mp3"
        }
      ]
    }
  ],
  "background": {
    "links": [
      "https://cdn.pixabay.com/example/video.mp4"
    ]
  },
  "ayat": [
    {
      "verse_key": "1:1",
      "aya": "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
      "translation": "In the name of Allah, the Entirely Merciful, the Especially Merciful"
    }
  ]
}
```

**Response:**
```json
{
  "output": "/path/to/video/file.mp4",
  "videoUrl": "https://your-bucket.r2.cloudflarestorage.com/videos/123/final_output.mp4",
  "presignedUrl": "https://your-bucket.r2.cloudflarestorage.com/videos/123/final_output.mp4?token=...",
  "videoId": "123456789"
}
```

### 2. Get Video URL

**Endpoint:** `GET /videos/:id`

**Response:**
```json
{
  "videoId": "123456789",
  "presignedUrl": "https://your-bucket.r2.cloudflarestorage.com/videos/123/final_output.mp4?token=...",
  "expiresIn": 7200
}
```

## RunPod Serverless Integration

This API also supports RunPod serverless deployment. The handler function accepts the following routes:

### 1. Video URL Generation

```json
{
  "input": {
    "route": "video",
    "videoId": "123456789",
    "expirySeconds": 7200
  }
}
```

### 2. Video Processing

```json
{
  "input": {
    "route": "process",
    "recitation_files": [...],
    "background": {...},
    "ayat": [...]
  }
}
```

## License

MIT