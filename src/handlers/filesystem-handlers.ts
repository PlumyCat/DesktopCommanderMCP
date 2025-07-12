import {
    readFile,
    readMultipleFiles,
    writeFile,
    createDirectory,
    listDirectory,
    moveFile,
    searchFiles,
    getFileInfo,
    type FileResult,
    type MultiFileResult
} from '../tools/filesystem.js';

import { ServerResult } from '../types.js';
import { withTimeout } from '../utils/withTimeout.js';
import { createErrorResponse } from '../error-handlers.js';
import { configManager } from '../config-manager.js';

import {
    ReadFileArgsSchema,
    ReadMultipleFilesArgsSchema,
    WriteFileArgsSchema,
    CreateDirectoryArgsSchema,
    ListDirectoryArgsSchema,
    MoveFileArgsSchema,
    SearchFilesArgsSchema,
    GetFileInfoArgsSchema
} from '../tools/schemas.js';

/**
 * Helper function to check if path contains an error
 */
function isErrorPath(path: string): boolean {
    return path.startsWith('__ERROR__:');
}

/**
 * Extract error message from error path
 */
function getErrorFromPath(path: string): string {
    return path.substring('__ERROR__:'.length).trim();
}

/**
 * Handle read_file command
 */
export async function handleReadFile(args: unknown): Promise<ServerResult> {
    const HANDLER_TIMEOUT = 60000; // 60 seconds total operation timeout
    // Add input validation
    if (args === null || args === undefined) {
        return createErrorResponse('No arguments provided for read_file command');
    }
    const readFileOperation = async () => {
        const parsed = ReadFileArgsSchema.parse(args);

        // Get the configuration for file read limits
        const config = await configManager.getConfig();
        if (!config) {
            return createErrorResponse('Configuration not available');
        }

        const defaultLimit = config.fileReadLineLimit ?? 1000;

        // Use the provided limits or defaults
        const offset = parsed.offset ?? 0;
        const length = parsed.length ?? defaultLimit;

        const fileResult = await readFile(parsed.path, parsed.isUrl, offset, length);

        if (fileResult.isImage) {
            // For image files, return as an image content type
            return {
                content: [
                    {
                        type: "text",
                        text: `Image file: ${parsed.path} (${fileResult.mimeType})\n`
                    },
                    {
                        type: "image",
                        data: fileResult.content,
                        mimeType: fileResult.mimeType
                    }
                ],
            };
        } else {
            // For all other files, return as text
            return {
                content: [{ type: "text", text: fileResult.content }],
            };
        }
    };

    // Execute with timeout at the handler level
    const result = await withTimeout(
        readFileOperation(),
        HANDLER_TIMEOUT,
        'Read file handler operation',
        null
    );
    if (result == null) {
        // Handles the impossible case where withTimeout resolves to null instead of throwing
        throw new Error('Failed to read the file');
    }
    return result;
}

/**
 * Handle read_multiple_files command
 */
export async function handleReadMultipleFiles(args: unknown): Promise<ServerResult> {
    const parsed = ReadMultipleFilesArgsSchema.parse(args);
    const fileResults = await readMultipleFiles(parsed.paths);

    // Create a text summary of all files
    const textSummary = fileResults.map(result => {
        if (result.error) {
            return `${result.path}: Error - ${result.error}`;
        } else if (result.mimeType) {
            return `${result.path}: ${result.mimeType} ${result.isImage ? '(image)' : '(text)'}`;
        } else {
            return `${result.path}: Unknown type`;
        }
    }).join("\n");

    // Create content items for each file
    const contentItems: Array<{ type: string, text?: string, data?: string, mimeType?: string }> = [];

    // Add the text summary
    contentItems.push({ type: "text", text: textSummary });

    // Add each file content
    for (const result of fileResults) {
        if (!result.error && result.content !== undefined) {
            if (result.isImage && result.mimeType) {
                // For image files, add an image content item
                contentItems.push({
                    type: "image",
                    data: result.content,
                    mimeType: result.mimeType
                });
            } else {
                // For text files, add a text summary
                contentItems.push({
                    type: "text",
                    text: `\n--- ${result.path} contents: ---\n${result.content}`
                });
            }
        }
    }

    return { content: contentItems };
}

/**
 * Handle write_file command
 */
export async function handleWriteFile(args: unknown): Promise<ServerResult> {
    try {
        const parsed = WriteFileArgsSchema.parse(args);

        // Get the line limit from configuration
        const config = await configManager.getConfig();
        const MAX_LINES = config.fileWriteLineLimit ?? 50; // Default to 50 if not set

        // Strictly enforce line count limit
        const lines = parsed.content.split('\n');
        const lineCount = lines.length;
        let errorMessage = "";
        if (lineCount > MAX_LINES) {
            errorMessage = `✅ File written successfully! (${lineCount} lines)
            
💡 Performance tip: For optimal speed, consider chunking files into ≤30 line pieces in future operations.`;
        }

        // Pass the mode parameter to writeFile
        await writeFile(parsed.path, parsed.content, parsed.mode);

        // Provide more informative message based on mode
        const modeMessage = parsed.mode === 'append' ? 'appended to' : 'wrote to';

        return {
            content: [{
                type: "text",
                text: `Successfully ${modeMessage} ${parsed.path} (${lineCount} lines) ${errorMessage}`
            }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle create_directory command
 */
export async function handleCreateDirectory(args: unknown): Promise<ServerResult> {
    try {
        const parsed = CreateDirectoryArgsSchema.parse(args);
        await createDirectory(parsed.path);
        return {
            content: [{ type: "text", text: `Successfully created directory ${parsed.path}` }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle list_directory command
 */
export async function handleListDirectory(args: unknown): Promise<ServerResult> {
    try {
        const parsed = ListDirectoryArgsSchema.parse(args);
        const entries = await listDirectory(parsed.path);
        return {
            content: [{ type: "text", text: entries.join('\n') }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle move_file command
 */
export async function handleMoveFile(args: unknown): Promise<ServerResult> {
    try {
        const parsed = MoveFileArgsSchema.parse(args);
        await moveFile(parsed.source, parsed.destination);
        return {
            content: [{ type: "text", text: `Successfully moved ${parsed.source} to ${parsed.destination}` }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle search_files command with improved performance and timeout handling
 */
export async function handleSearchFiles(args: unknown): Promise<ServerResult> {
    try {
        const parsed = SearchFilesArgsSchema.parse(args);

        // Prepare search options with defaults
        const searchOptions = {
            maxResults: parsed.maxResults ?? 1000,
            maxDepth: parsed.maxDepth ?? 10,
            timeoutMs: parsed.timeoutMs ?? 10000, // Reduced default from 30s to 10s
            excludeDirs: parsed.excludeDirs ?? ['node_modules', '.git', 'dist', '.cache', 'tmp']
        };

        // The searchFiles function now handles timeout internally
        const results = await searchFiles(parsed.path, parsed.pattern, searchOptions);

        if (results.length === 0) {
            return {
                content: [{
                    type: "text",
                    text: `No matches found for pattern "${parsed.pattern}" in ${parsed.path}\n\nSearch options used:\n- Max results: ${searchOptions.maxResults}\n- Max depth: ${searchOptions.maxDepth}\n- Timeout: ${searchOptions.timeoutMs}ms\n- Excluded directories: ${searchOptions.excludeDirs.join(', ')}`
                }],
            };
        }

        // Provide detailed results with performance info
        let response = `Found ${results.length} matches for pattern "${parsed.pattern}":\n\n`;
        response += results.join('\n');

        // Add search info footer
        if (results.length >= searchOptions.maxResults) {
            response += `\n\n⚠️ Results limited to ${searchOptions.maxResults}. Use maxResults parameter to see more.`;
        }
        if (searchOptions.maxDepth < 20) {
            response += `\n💡 Searched to depth ${searchOptions.maxDepth}. Use maxDepth parameter to search deeper.`;
        }

        return {
            content: [{ type: "text", text: response }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Enhanced error handling for timeout cases
        if (errorMessage.includes('timed out')) {
            return {
                content: [{
                    type: "text",
                    text: `Search operation timed out. Try:\n- Reducing search scope with maxDepth parameter\n- Adding more excluded directories\n- Increasing timeout with timeoutMs parameter\n\nError: ${errorMessage}`
                }],
                isError: true
            };
        }

        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle get_file_info command
 */
export async function handleGetFileInfo(args: unknown): Promise<ServerResult> {
    try {
        const parsed = GetFileInfoArgsSchema.parse(args);
        const info = await getFileInfo(parsed.path);
        return {
            content: [{
                type: "text",
                text: Object.entries(info)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n')
            }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

// The listAllowedDirectories function has been removed
// Use get_config to retrieve the allowedDirectories configuration
