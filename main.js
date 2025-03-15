import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import ffmpeg from 'fluent-ffmpeg';
import { createCanvas, registerFont } from 'canvas';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Get current directory
const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );

// Register fonts
const fontFileArabic = path.join( __dirname, 'static', 'fonts', 'UthmanicHafs1Ver13.otf' );
registerFont( fontFileArabic, { family: 'UthmanicHafs' } );
const fontFileTranslation = path.join( __dirname, 'static', 'fonts', 'ClashDisplay-Regular.otf' );
registerFont( fontFileTranslation, { family: 'ClashDisplay' } );

// R2 storage configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || '';

// Initialize S3 client for Cloudflare R2
const s3Client = new S3Client( {
    region: 'auto', // Cloudflare R2 uses 'auto' as the region
    endpoint: `https://${ R2_ACCOUNT_ID }.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
} );

// Enable debug mode for development
const debugMode = process.env.NODE_ENV !== 'production';

/**
 * Generate a unique ID for each request
 */
function generateShortId() {
    return `${ Date.now() }-${ Math.floor( Math.random() * 10000 ) }`;
}

/**
 * Upload a file to R2 storage.
 */
async function uploadFileToR2( filePath, key, contentType = 'video/mp4' ) {
    // Read the file from the local filesystem
    const fileContent = fs.readFileSync( filePath );

    // Create the command for uploading the file
    const command = new PutObjectCommand( {
        Bucket: R2_BUCKET_NAME,
        Key: key,
        Body: fileContent,
        ContentType: contentType,
    } );

    // Upload the file to R2
    await s3Client.send( command );

    // Construct the public URL
    const publicUrl = `https://${ R2_ACCOUNT_ID }.r2.cloudflarestorage.com/${ R2_BUCKET_NAME }/${ key }`;

    // Generate a presigned URL (this is simplified, in production would use getSignedUrl)
    const presignedUrl = `${ publicUrl }?token=sample_token&expires=${ Date.now() + 7200 * 1000 }`;

    return { url: publicUrl, presignedUrl };
}

/**
 * Upload a video file to R2 storage.
 */
async function uploadVideoToR2( videoPath, videoId ) {
    // Create a unique key for the video file
    const key = `videos/${ videoId }/${ path.basename( videoPath ) }`;

    // Upload the video file and get its public URL
    const result = await uploadFileToR2( videoPath, key );

    return { ...result, key, videoId };
}

/**
 * Generate a presigned URL for accessing a video.
 * This function mimics the SvelteKit endpoint behavior from +server.ts
 *
 * @param {string} videoId - The ID of the video to generate a URL for.
 * @param {number} expirySeconds - Expiry time in seconds (default: 7200 - 2 hours).
 * @returns {Promise<Object>} - A promise that resolves to the result object.
 */
async function getPresignedUrlForVideo( videoId, expirySeconds = 7200 ) {
    try {
        if ( !videoId ) {
            return {
                error: 'Video ID is required',
                status: 400
            };
        }

        // Construct the storage key based on the video ID
        const key = `videos/${ videoId }/final_output.mp4`;

        // In production, this would call your R2 service
        // For demonstration, we'll use a placeholder URL
        const presignedUrl = `https://${ R2_ACCOUNT_ID }.r2.cloudflarestorage.com/${ R2_BUCKET_NAME }/${ key }?token=sample_token&expires=${ Date.now() + expirySeconds * 1000 }`;

        // Return the successful response
        return {
            videoId,
            presignedUrl,
            expiresIn: expirySeconds,
            status: 200
        };
    } catch ( err ) {
        console.error( 'Error retrieving video:', err );
        return {
            error: err instanceof Error ? err.message : 'Failed to retrieve video',
            status: err instanceof Error && err.message.includes( '400' ) ? 400 : 500
        };
    }
}

/**
 * Get the duration of an audio file using ffprobe.
 */
async function getAudioDuration( audioPath ) {
    return new Promise( ( resolve, reject ) => {
        ffmpeg.ffprobe( audioPath, ( err, metadata ) => {
            if ( err ) return reject( err );
            resolve( metadata.format.duration || 0 );
        } );
    } );
}

/**
 * Download audio and video files, and get audio durations.
 */
async function downloadFiles( recitation_files, background, ayat, tempDir ) {
    const audioPaths = [];
    const audioDurations = [];
    const videoPaths = [];

    for ( let i = 0; i < recitation_files.length; i++ ) {
        const recitation_file = recitation_files[i];
        const verse = ayat[i] || { verse_key: `unknown-${ i }` };
        const audioUrl = `https://verses.quran.com/${ recitation_file.audio_files[0].url }`;
        const audioPath = path.join( tempDir, `audio_${ verse.verse_key.replace( /:/g, '_' ) }.mp3` );

        try {
            const response = await fetch( audioUrl );
            if ( !response.ok ) throw new Error( `Failed to fetch audio: ${ audioUrl }` );
            const buffer = await response.arrayBuffer();
            fs.writeFileSync( audioPath, Buffer.from( buffer ) );
            audioPaths.push( audioPath );
            const duration = await getAudioDuration( audioPath );
            audioDurations.push( duration );
            console.log( `Downloaded audio to ${ audioPath }, duration: ${ duration }s` );
        } catch ( err ) {
            throw new Error( `Audio download failed for ${ verse.verse_key }: ${ err instanceof Error ? err.message : String( err ) }` );
        }
    }

    for ( const [index, videoUrl] of background.links.entries() ) {
        if ( videoUrl.startsWith( 'https://cdn.pixabay.com/' ) ) {
            const videoPath = path.join( tempDir, `background_${ index }.mp4` );
            try {
                const response = await fetch( videoUrl );
                if ( !response.ok ) throw new Error( `Failed to fetch video: ${ videoUrl }` );
                const buffer = await response.arrayBuffer();
                fs.writeFileSync( videoPath, Buffer.from( buffer ) );
                videoPaths.push( videoPath );
                console.log( `Downloaded video to ${ videoPath }` );
            } catch ( err ) {
                throw new Error( `Video download failed for ${ videoUrl }: ${ err instanceof Error ? err.message : String( err ) }` );
            }
        }
    }

    if ( videoPaths.length === 0 ) throw new Error( "No valid background video provided" );

    return { audioPaths, audioDurations, videoPaths };
}

/**
 * Concatenate multiple media files into a single file.
 */
async function concatenateMedia( filePaths, type, tempDir ) {
    if ( filePaths.length === 0 ) throw new Error( `No ${ type } files to concatenate` );
    if ( filePaths.length === 1 ) return filePaths[0];

    const concatListPath = path.join( tempDir, `${ type }_concat.txt` );
    const concatContent = filePaths.map( p => `file '${ p.replace( /'/g, "'\\''" ) }'` ).join( '\n' );
    fs.writeFileSync( concatListPath, concatContent );

    const outputPath = path.join( tempDir, `concatenated_${ type }.${ type === 'video' ? 'mp4' : 'mp3' }` );
    await new Promise( ( resolve, reject ) => {
        new ffmpeg()
            .input( concatListPath )
            .inputOptions( ['-f', 'concat', '-safe', '0'] )
            .outputOptions( ['-c', 'copy'] )
            .save( outputPath )
            .on( 'end', () => {
                console.log( `${ type } files concatenated successfully` );
                resolve();
            } )
            .on( 'error', ( err ) => {
                console.error( `Error concatenating ${ type }:`, err );
                reject( err );
            } );
    } );

    return outputPath;
}

/**
 * Render Arabic text into a PNG image.
 */
async function renderArabicTextImage( text, outputPath ) {
    const width = 950;
    const ctx = createCanvas( width, 10 ).getContext( '2d' );

    ctx.font = '65px "UthmanicHafs"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxWidth = width * 0.9;
    const words = text.split( ' ' );
    let line = '';
    const lines = [];

    for ( const word of words ) {
        const testLine = line + word + ' ';
        const metrics = ctx.measureText( testLine );
        if ( metrics.width > maxWidth && line !== '' ) {
            lines.push( line );
            line = word + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push( line );

    const lineHeight = 100;
    const totalHeight = lines.length * lineHeight;
    const canvasHeight = totalHeight + 100;

    const canvas = createCanvas( width, canvasHeight );
    const finalCtx = canvas.getContext( '2d' );

    finalCtx.clearRect( 0, 0, width, canvasHeight );
    finalCtx.font = '65px "UthmanicHafs"';
    finalCtx.textAlign = 'center';
    finalCtx.textBaseline = 'middle';
    finalCtx.fillStyle = 'white';

    const startY = 50 + lineHeight / 2;

    for ( let i = 0; i < lines.length; i++ ) {
        finalCtx.fillText( lines[i], width / 2, startY + i * lineHeight );
    }

    fs.writeFileSync( outputPath, canvas.toBuffer( 'image/png' ) );

    return totalHeight;
}

/**
 * Generate Arabic text images.
 */
async function generateArabicImages( ayat, tempDir ) {
    const imagePaths = [];
    const textHeights = [];
    for ( const ayah of ayat ) {
        const imagePath = path.join( tempDir, `arabic_${ ayah.verse_key.replace( /:/g, '_' ) }.png` );
        const height = await renderArabicTextImage( ayah.aya, imagePath );
        imagePaths.push( imagePath );
        textHeights.push( height );
        console.log( `Generated Arabic image at ${ imagePath }` );
    }
    return [imagePaths, textHeights];
}

/**
 * Render translation text into a PNG image.
 */
async function renderTranslationTextImage( text, outputPath ) {
    const width = 950;
    const ctx = createCanvas( width, 10 ).getContext( '2d' );

    ctx.font = '32px "ClashDisplay"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxWidth = width * 0.9;
    const words = text.split( ' ' );
    let line = '';
    const lines = [];

    for ( const word of words ) {
        const testLine = line + word + ' ';
        const metrics = ctx.measureText( testLine );
        if ( metrics.width > maxWidth && line !== '' ) {
            lines.push( line );
            line = word + ' ';
        } else {
            line = testLine;
        }
    }
    lines.push( line );

    const lineHeight = 45;
    const totalHeight = lines.length * lineHeight;
    const canvasHeight = totalHeight + 100;

    const canvas = createCanvas( width, canvasHeight );
    const finalCtx = canvas.getContext( '2d' );

    finalCtx.clearRect( 0, 0, width, canvasHeight );
    finalCtx.font = '32px "ClashDisplay"';
    finalCtx.textAlign = 'center';
    finalCtx.textBaseline = 'middle';
    finalCtx.fillStyle = 'white';

    const startY = 50 + lineHeight / 2;

    for ( let i = 0; i < lines.length; i++ ) {
        finalCtx.fillText( lines[i], width / 2, startY + i * lineHeight );
    }

    fs.writeFileSync( outputPath, canvas.toBuffer( 'image/png' ) );

    return totalHeight;
}

/**
 * Generate translation text images.
 */
async function generateTranslationImages( ayat, tempDir ) {
    const imagePaths = [];
    const textHeights = [];
    for ( const ayah of ayat ) {
        const imagePath = path.join( tempDir, `translation_${ ayah.verse_key.replace( /:/g, '_' ) }.png` );
        const height = await renderTranslationTextImage( ayah.translation, imagePath );
        imagePaths.push( imagePath );
        textHeights.push( height );
        console.log( `Generated translation image at ${ imagePath }` );
    }
    return [imagePaths, textHeights];
}

/**
 * Build the final video with precise timing and repositioned overlays.
 */
async function buildVideoWithOverlays(
    videoPath,
    audioPath,
    arabicImagePaths,
    translationImagePaths,
    ayat,
    audioDurations,
    translationTextHeights,
    arabicTextHeights,
    tempDir
) {
    // Calculate precise start times
    let currentTime = 0;
    const startTimes = [];
    for ( const duration of audioDurations ) {
        startTimes.push( currentTime );
        currentTime += duration;
    }
    const totalDuration = currentTime;

    // Construct FFmpeg filter complex
    const filterComplexParts = [];
    filterComplexParts.push( `[0:v]scale=1080:1920,format=yuva420p[bg]` );

    // Add the vignette over the background
    const bgImagePath = path.resolve( process.cwd(), 'static', 'bg-vid-gradient.png' );
    filterComplexParts.push( `[bg][3:v]overlay=(W-w)/2:(H-h)/2[vig]` );

    // Scale down the watermark to make it smaller (70% of original size)
    filterComplexParts.push( `[2:v]scale=iw*0.7:ih*0.7[scaled_watermark]` );

    // Add the watermark at the bottom of the screen - always visible
    const watermarkY = 1920 - 300;
    filterComplexParts.push( `[vig][scaled_watermark]overlay=(W-w)/2:${ watermarkY }[with_watermark]` );

    // Remove the Quran.gg text watermark
    let prevLabel = 'with_watermark';

    for ( let i = 0; i < ayat.length; i++ ) {
        const startTime = startTimes[i];
        const endTime = startTime + audioDurations[i];
        const translationHeight = translationTextHeights[i];
        const arabicHeight = arabicTextHeights[i];

        // Calculate positions
        const translationY = watermarkY - ( translationHeight + 100 ) - 50;
        const translationLabel = `trans${ i }`;

        // Add translation text
        filterComplexParts.push(
            `[${ prevLabel }][${ i + arabicImagePaths.length + 4 }:v]overlay=x=(W-w)/2:y=${ translationY }:enable='between(t,${ startTime },${ endTime })'[${ translationLabel }]`
        );

        // Arabic overlay positioned above translation
        const arabicY = translationY - ( arabicHeight + 24 );
        const arabicLabel = `arabic${ i }`;

        // Add Arabic text
        filterComplexParts.push(
            `[${ translationLabel }][${ i + 4 }:v]overlay=x=(W-w)/2:y=${ arabicY }:enable='between(t,${ startTime },${ endTime })'[${ arabicLabel }]`
        );

        prevLabel = arabicLabel;
    }

    const finalVideoLabel = prevLabel;
    const filterComplex = filterComplexParts.join( ';' );
    const outputPath = path.join( tempDir, 'final_output.mp4' ).replace( /\\/g, '/' );
    const watermarkPath = path.resolve( process.cwd(), 'static', 'images', 'quran-watermark.png' );

    await new Promise( ( resolve, reject ) => {
        const command = new ffmpeg()
            .input( videoPath )
            .inputOptions( ['-stream_loop', '-1'] )
            .input( audioPath )
            .input( watermarkPath )
            .input( bgImagePath );

        for ( const imagePath of arabicImagePaths ) command.input( imagePath );
        for ( const imagePath of translationImagePaths ) command.input( imagePath );

        command
            .complexFilter( filterComplex, finalVideoLabel )
            .outputOptions( [
                '-t', totalDuration.toString(),
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-pix_fmt', 'yuv420p',
                '-threads', '5',
                '-b:v', '2.5M',
                '-preset', 'medium',
                '-crf', '23',
                '-maxrate', '3M',
                '-bufsize', '6M',
                '-map', '1:a'
            ] )
            .save( outputPath )
            .on( 'end', () => {
                console.log( 'Final video built successfully' );
                resolve();
            } )
            .on( 'error', ( err ) => {
                console.error( 'Error building video:', err );
                reject( err );
            } );
    } );

    return outputPath;
}

/**
 * Process a video generation request
 */
async function processVideoRequest( recitation_files, background, ayat ) {
    const request_id = generateShortId();
    const tempDir = path.resolve( process.cwd(), 'temp', request_id );

    try {
        if ( !fs.existsSync( tempDir ) ) fs.mkdirSync( tempDir, { recursive: true } );

        const { audioPaths, audioDurations, videoPaths } = await downloadFiles(
            recitation_files,
            background,
            ayat,
            tempDir
        );

        const finalVideoInput = await concatenateMedia( videoPaths, 'video', tempDir );
        const audioInput = await concatenateMedia( audioPaths, 'audio', tempDir );
        const [arabicImagePaths, arabicTextHeights] = await generateArabicImages( ayat, tempDir );
        const [translationImagePaths, translationTextHeights] = await generateTranslationImages( ayat, tempDir );

        const finalOutputPath = await buildVideoWithOverlays(
            finalVideoInput,
            audioInput,
            arabicImagePaths,
            translationImagePaths,
            ayat,
            audioDurations,
            translationTextHeights,
            arabicTextHeights,
            tempDir
        );

        // Upload the final video to R2 storage
        const videoId = request_id;
        const uploadResult = await uploadVideoToR2( finalOutputPath, videoId );
        console.log( `Video uploaded to R2: ${ uploadResult.url }` );

        // Cleanup (skip if in debug mode)
        if ( !debugMode ) {
            fs.rmSync( tempDir, { recursive: true } );
            console.log( 'Temporary directory cleaned up' );
        } else {
            console.log( `Debug mode enabled: Temporary files preserved at ${ tempDir }` );
        }

        return {
            output: finalOutputPath,
            videoUrl: uploadResult.url,
            presignedUrl: uploadResult.presignedUrl,
            videoId
        };
    } catch ( err ) {
        console.error( 'Error in video processing:', err );
        throw err;
    }
}

/**
 * Handler function for HTTP requests.
 * Supports SvelteKit-style route parameters and RunPod serverless format.
 */
async function handler( req, res ) {
    try {
        const parsedUrl = url.parse( req.url, true );
        const pathname = parsedUrl.pathname;

        // Set appropriate CORS headers for all responses
        res.setHeader( 'Access-Control-Allow-Origin', '*' );
        res.setHeader( 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS' );
        res.setHeader( 'Access-Control-Allow-Headers', 'Content-Type' );

        // Handle preflight requests
        if ( req.method === 'OPTIONS' ) {
            res.writeHead( 204 );
            res.end();
            return;
        }

        // Add a root path handler for status checks
        if ( req.method === 'GET' && ( pathname === '/' || pathname === '' ) ) {
            res.writeHead( 200, { 'Content-Type': 'application/json' } );
            res.end( JSON.stringify( {
                status: 'ok',
                service: 'Quran API',
                version: '1.0.0',
                endpoints: [
                    { method: 'GET', path: '/videos/:id' },
                    { method: 'POST', path: '/process' }
                ],
                runpod: {
                    info: 'For RunPod serverless, submit requests directly to the root endpoint',
                    required_parameters: ['recitation_files', 'background', 'ayat']
                }
            } ) );
            return;
        }

        // Handle GET requests for video presigned URLs
        // Pattern matching for routes like /videos/:id similar to SvelteKit +server.ts
        if ( req.method === 'GET' && pathname.startsWith( '/videos/' ) ) {
            const videoId = pathname.split( '/' )[2]; // Extract ID from /videos/:id
            const result = await getPresignedUrlForVideo( videoId );

            res.writeHead( result.status || 200, { 'Content-Type': 'application/json' } );
            delete result.status; // Remove status from response body
            res.end( JSON.stringify( result ) );
            return;
        }

        // Handle POST requests for processing
        if ( req.method === 'POST' && pathname === '/process' ) {
            let body = '';
            req.on( 'data', ( chunk ) => {
                body += chunk.toString();
            } );

            req.on( 'end', async () => {
                try {
                    console.log( 'Received request body:', body );
                    const data = JSON.parse( body );

                    // Extract required fields from the request
                    const { recitation_files, background, ayat } = data;

                    if ( !recitation_files || !background || !ayat ) {
                        res.writeHead( 400, { 'Content-Type': 'application/json' } );
                        res.end( JSON.stringify( {
                            error: 'Missing required fields: recitation_files, background, or ayat'
                        } ) );
                        return;
                    }

                    // Process the video
                    const result = await processVideoRequest( recitation_files, background, ayat );

                    res.writeHead( 200, { 'Content-Type': 'application/json' } );
                    res.end( JSON.stringify( result ) );
                } catch ( err ) {
                    console.error( 'Error processing request:', err );
                    res.writeHead( 500, { 'Content-Type': 'application/json' } );
                    res.end( JSON.stringify( {
                        error: err instanceof Error ? err.message : 'Error processing the request'
                    } ) );
                }
            } );
            return;
        }

        // Handle any other request
        res.writeHead( 404, { 'Content-Type': 'application/json' } );
        res.end( JSON.stringify( { error: 'Endpoint not found' } ) );
    } catch ( err ) {
        console.error( 'Server error:', err );
        res.writeHead( 500, { 'Content-Type': 'application/json' } );
        res.end( JSON.stringify( { error: 'Internal Server Error' } ) );
    }
}

/**
 * RunPod serverless handler function that adapts the HTTP handler
 * to the RunPod serverless format.
 *
 * @param {Object} event - The RunPod serverless event.
 * @returns {Promise<Object>} - A promise that resolves to the response.
 */
export async function runpodHandler( event ) {
    const { input } = event;

    // Handle video URL generation requests if specified
    if ( input.route === 'video' ) {
        return await getPresignedUrlForVideo( input.videoId, input.expirySeconds );
    }
    // Process request directly at root route if it has the necessary parameters
    else if ( input.recitation_files && input.background && input.ayat ) {
        try {
            return await processVideoRequest( input.recitation_files, input.background, input.ayat );
        } catch ( err ) {
            return {
                error: err instanceof Error ? err.message : 'Error processing the request'
            };
        }
    }
    // Fallback for unknown route or missing parameters
    else {
        return {
            error: 'Missing required fields: recitation_files, background, or ayat'
        };
    }
}

// Always start the server when running as a standalone application (not imported)
if ( import.meta.url === `file://${ process.argv[1] }` ) {
    const port = process.env.PORT || 3000;
    const host = '0.0.0.0'; // Listen on all interfaces
    http.createServer( handler ).listen( port, host, () => {
        console.log( `Server is running on http://${ host }:${ port } in ${ process.env.NODE_ENV } mode` );
        console.log( `You can also access it at http://localhost:${ port }` );
        console.log( `GET /videos/:id - Get presigned URL for a video` );
        console.log( `POST /process - Process recitation files (HTTP server only)` );
        console.log( `For RunPod: Submit requests directly to the root endpoint with recitation_files, background, and ayat parameters` );
    } );
}

// Export the handlers for both HTTP server and RunPod serverless
export { runpodHandler as handler, handler as httpHandler };
