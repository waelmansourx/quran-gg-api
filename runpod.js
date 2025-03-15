import http from 'http';
import fs from 'fs';
import { runpodHandler } from './main.js';

// Constants
const INPUT_DIR = '/inputs';
const OUTPUT_DIR = '/outputs';
const RUNPOD_HANDLER_PORT = process.env.RUNPOD_HANDLER_PORT || 8000;

// Create outputs directory if it doesn't exist
if ( !fs.existsSync( OUTPUT_DIR ) ) {
    fs.mkdirSync( OUTPUT_DIR, { recursive: true } );
}

// Function to read and parse job input
async function readJobInput( jobId ) {
    try {
        const inputFilePath = `${ INPUT_DIR }/${ jobId }/input.json`;

        if ( fs.existsSync( inputFilePath ) ) {
            const inputData = JSON.parse( fs.readFileSync( inputFilePath, 'utf8' ) );
            return inputData;
        }
        return null;
    } catch ( error ) {
        console.error( 'Error reading job input:', error );
        return null;
    }
}

// Function to write job output
async function writeJobOutput( jobId, result ) {
    try {
        const jobOutputDir = `${ OUTPUT_DIR }/${ jobId }`;
        if ( !fs.existsSync( jobOutputDir ) ) {
            fs.mkdirSync( jobOutputDir, { recursive: true } );
        }

        fs.writeFileSync( `${ jobOutputDir }/output.json`, JSON.stringify( result ) );
        return true;
    } catch ( error ) {
        console.error( 'Error writing job output:', error );
        return false;
    }
}

// Create HTTP server to handle RunPod requests
const server = http.createServer( async ( req, res ) => {
    try {
        // Set CORS headers
        res.setHeader( 'Access-Control-Allow-Origin', '*' );
        res.setHeader( 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS' );
        res.setHeader( 'Access-Control-Allow-Headers', 'Content-Type' );

        // Handle OPTIONS request (preflight)
        if ( req.method === 'OPTIONS' ) {
            res.writeHead( 204 );
            res.end();
            return;
        }

        // Handle health check
        if ( req.url === '/health' && req.method === 'GET' ) {
            res.writeHead( 200, { 'Content-Type': 'application/json' } );
            res.end( JSON.stringify( { status: 'ok' } ) );
            return;
        }

        // Handle job request
        if ( req.url.startsWith( '/run' ) && req.method === 'POST' ) {
            let body = '';
            req.on( 'data', ( chunk ) => {
                body += chunk.toString();
            } );

            req.on( 'end', async () => {
                try {
                    const { id, input } = JSON.parse( body );
                    console.log( `[${ id }] Received job`, JSON.stringify( input ) );

                    // Process the request using the handler from main.js
                    const result = await runpodHandler( { input } );

                    // Return result
                    res.writeHead( 200, { 'Content-Type': 'application/json' } );
                    res.end( JSON.stringify( { id, output: result } ) );

                    // Write output to file for RunPod to collect
                    await writeJobOutput( id, result );
                    console.log( `[${ id }] Job completed` );
                } catch ( error ) {
                    console.error( 'Error processing job:', error );
                    res.writeHead( 500, { 'Content-Type': 'application/json' } );
                    res.end( JSON.stringify( {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    } ) );
                }
            } );
            return;
        }

        // Handle unknown routes
        res.writeHead( 404, { 'Content-Type': 'application/json' } );
        res.end( JSON.stringify( { error: 'Not Found' } ) );
    } catch ( error ) {
        console.error( 'Server error:', error );
        res.writeHead( 500, { 'Content-Type': 'application/json' } );
        res.end( JSON.stringify( { error: 'Internal Server Error' } ) );
    }
} );

// Start server
server.listen( RUNPOD_HANDLER_PORT, '0.0.0.0', () => {
    console.log( `RunPod serverless handler started on port ${ RUNPOD_HANDLER_PORT }` );
} );