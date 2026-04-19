import { UserRoleTypes } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { APIEvent } from "@solidjs/start/server";
import { createReadStream, existsSync, statSync } from "fs";
import { basename } from "path";
import {
    assertAccessibleRecordingSession,
    getRecordingContentType,
    resolveRecordingFilePath,
} from "../../../server/api/routers/recordings.shared";
import { verifyAndDecodeToken } from "../../../server/middleware/auth.middlewares";

function createJsonErrorResponse(status: number, message: string): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function getStatusFromTrpcError(error: TRPCError): number {
    switch (error.code) {
        case "BAD_REQUEST":
            return 400;
        case "UNAUTHORIZED":
            return 401;
        case "NOT_FOUND":
            return 404;
        default:
            return 500;
    }
}

function createDownloadStream(filePath: string): ReadableStream<Uint8Array> {
    const nodeStream = createReadStream(filePath);

    return new ReadableStream<Uint8Array>({
        start(controller) {
            nodeStream.on("data", (chunk: Buffer) => {
                controller.enqueue(new Uint8Array(chunk));
            });
            nodeStream.on("end", () => {
                controller.close();
            });
            nodeStream.on("error", (error) => {
                controller.error(error);
            });
        },
        cancel() {
            nodeStream.destroy();
        },
    });
}

/**
 * File download endpoint for recordings
 * GET /api/recordings/download?session=<sessionId>&file=<filename>
 */
export async function GET(event: APIEvent): Promise<Response> {
    const url = new URL(event.request.url);
    const sessionId = url.searchParams.get("session");
    const fileName = url.searchParams.get("file");

    if (!sessionId || !fileName) {
        return createJsonErrorResponse(400, "Missing session or file parameter");
    }

    const authHeader = event.request.headers.get("Authorization");
    let user;

    try {
        const decodedToken = verifyAndDecodeToken(authHeader);

        if (typeof decodedToken === "string") {
            return createJsonErrorResponse(401, decodedToken);
        }

        user = decodedToken;
    } catch (error) {
        return createJsonErrorResponse(
            401,
            error instanceof Error ? error.message : "Invalid authentication.",
        );
    }

    try {
        assertAccessibleRecordingSession(
            sessionId,
            user.discordId,
            user.roles.includes(UserRoleTypes.ADMIN),
        );

        const filePath = resolveRecordingFilePath(sessionId, fileName);

        if (!existsSync(filePath)) {
            return createJsonErrorResponse(404, "File not found");
        }

        const fileStat = statSync(filePath);
        if (!fileStat.isFile()) {
            return createJsonErrorResponse(404, "File not found");
        }

        const downloadFileName = basename(filePath);
        const downloadStream = createDownloadStream(filePath);

        return new Response(downloadStream, {
            headers: {
                "Content-Type": getRecordingContentType(downloadFileName),
                "Content-Disposition": `attachment; filename="${downloadFileName}"`,
                "Content-Length": fileStat.size.toString(),
            },
        });
    } catch (error) {
        if (error instanceof TRPCError) {
            return createJsonErrorResponse(getStatusFromTrpcError(error), error.message);
        }

        return createJsonErrorResponse(
            500,
            error instanceof Error ? error.message : "Unable to download recording file.",
        );
    }
}
