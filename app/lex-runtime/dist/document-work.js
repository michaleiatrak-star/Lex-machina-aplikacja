import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
/**
 * Two kinds of document work. Background: the OCR of files added to the case, read before the
 * user decides anything. Foreground: what the user waits for (correction, detection of personal
 * data, confirmation, a page edit). While any foreground work runs, background OCR pauses after
 * the page it is reading (the PaddleOCR worker waits while the pause file exists) and a new
 * background read does not start; it resumes when the foreground work is done. Foreground
 * work runs one at a time: the vision model stops the text model, which a confirmation or a
 * detection of another document may be using.
 */
export class DocumentWorkScheduler {
    pauseFile;
    foregroundRunning = 0;
    foregroundTail = Promise.resolve();
    waiting = new Set();
    backgroundContext = new AsyncLocalStorage();
    constructor(
    // Checked by the OCR worker between pages; exists only while foreground work runs.
    pauseFile = path.join(os.tmpdir(), `lex-ocr-pause-${process.pid}-${randomBytes(6).toString("hex")}`)) {
        this.pauseFile = pauseFile;
    }
    async foreground(work) {
        this.foregroundRunning += 1;
        if (this.foregroundRunning === 1)
            this.writePause(true);
        const previous = this.foregroundTail;
        let release;
        this.foregroundTail = new Promise((resolve) => {
            release = resolve;
        });
        try {
            await previous;
            // Foreground work started from background work (never in the app) would wait for itself.
            return await this.backgroundContext.exit(work);
        }
        finally {
            release();
            this.foregroundRunning -= 1;
            if (this.foregroundRunning === 0) {
                this.writePause(false);
                for (const wake of [...this.waiting])
                    wake();
            }
        }
    }
    async background(work) {
        await this.idle();
        return this.backgroundContext.run(true, work);
    }
    /** Inside background(): the OCR worker gets the pause file (see paddle_worker.py). */
    inBackground() {
        return this.backgroundContext.getStore() === true;
    }
    paused() {
        return this.foregroundRunning > 0;
    }
    /** Background work between steps: waits while foreground work runs. */
    async idle() {
        while (this.foregroundRunning > 0) {
            await new Promise((resolve) => {
                const wake = () => {
                    this.waiting.delete(wake);
                    resolve();
                };
                this.waiting.add(wake);
            });
        }
    }
    writePause(on) {
        try {
            if (on)
                writeFileSync(this.pauseFile, "");
            else
                rmSync(this.pauseFile, { force: true });
        }
        catch (error) {
            // Without the file the OCR only runs alongside; the foreground work still runs.
            process.stderr.write(`OCR_PAUSE_FILE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
        }
    }
}
export const documentWork = new DocumentWorkScheduler();
process.once("exit", () => {
    try {
        rmSync(documentWork.pauseFile, { force: true });
    }
    catch {
        // nothing to clean
    }
});
