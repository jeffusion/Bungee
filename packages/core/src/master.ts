import path from 'path';
import { Worker } from 'worker_threads';
import fs from 'fs';
import { logger } from './logger';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const WORKER_COUNT = process.env.WORKER_COUNT ? parseInt(process.env.WORKER_COUNT) : 2;
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8088;

interface WorkerInfo {
    worker: Worker;
    workerId: number;
    status: 'starting' | 'ready' | 'shutting_down' | 'stopped';
    exitPromise?: Promise<void>;
    exitResolve?: () => void;
}

class Master {
    private workers = new Map<number, WorkerInfo>();
    private config: any;
    private isReloading = false;
    private reloadTimeout: NodeJS.Timeout | null = null;

    constructor() {
        this.loadAndStart();
        this.watchConfig();
        this.handleSignals();
    }

    private async loadAndStart() {
        try {
            const configContent = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
            this.config = JSON.parse(configContent);
            logger.info('Configuration loaded successfully.');
            await this.startWorkers();
        } catch (error) {
            logger.error({ error }, 'Failed to load or parse config.json');
            process.exit(1);
        }
    }

    private async startWorkers() {
        logger.info(`Starting ${WORKER_COUNT} worker processes...`);

        // 串行启动 worker 进程，避免端口竞争
        for (let i = 0; i < WORKER_COUNT; i++) {
            const success = await this.forkWorker(i);
            if (!success) {
                logger.error(`Failed to start worker #${i}. Continuing with remaining workers.`);
            }
            // 添加小延迟以避免端口竞争
            if (i < WORKER_COUNT - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        logger.info('All workers have been started.');
    }

    private forkWorker(workerId: number): Promise<boolean> {
        return new Promise((resolve) => {
            const worker = new Worker(new URL('./worker.ts', import.meta.url).href, {
                workerData: {
                    workerId,
                    port: PORT,
                    configPath: CONFIG_PATH
                }
            });

            logger.info(`Starting worker #${workerId} with thread ID ${worker.threadId}`);

            let exitResolve: (() => void) | undefined;
            const exitPromise = new Promise<void>((res) => {
                exitResolve = res;
            });

            const workerInfo: WorkerInfo = {
                worker,
                workerId,
                status: 'starting',
                exitPromise,
                exitResolve
            };

            this.workers.set(workerId, workerInfo);

            // Set a timeout for worker startup
            const startupTimeout = setTimeout(() => {
                logger.error(`Worker #${workerId} (Thread ID: ${worker.threadId}) failed to start within timeout`);
                worker.terminate();
                this.workers.delete(workerId);
                resolve(false);
            }, 30000); // 30 second timeout

            worker.on('exit', (code) => {
                clearTimeout(startupTimeout);

                const wasStarting = workerInfo.status === 'starting';

                if (workerInfo.status === 'shutting_down') {
                    logger.info(`Worker #${workerId} (Thread ID: ${worker.threadId}) exited gracefully (code: ${code}).`);
                } else {
                    logger.warn(`Worker #${workerId} (Thread ID: ${worker.threadId}) exited unexpectedly with code ${code}.`);
                }

                this.workers.delete(workerId);
                workerInfo.status = 'stopped';

                // Resolve the exit promise
                if (exitResolve) {
                    exitResolve();
                }

                if (wasStarting) {
                    resolve(false);
                }
            });

            worker.on('message', (message: any) => {
                clearTimeout(startupTimeout);
                if (message.status === 'ready') {
                    logger.info(`Worker #${workerId} (Thread ID: ${worker.threadId}) reported ready.`);
                    workerInfo.status = 'ready';
                    resolve(true);
                } else if (message.status === 'error') {
                    const errorMsg = message.error || 'Unknown error';
                    logger.error(`Worker #${workerId} (Thread ID: ${worker.threadId}) reported an error: ${errorMsg}`);
                    worker.terminate();
                    this.workers.delete(workerId);
                    resolve(false);
                }
            });

            worker.on('error', (error) => {
                clearTimeout(startupTimeout);
                logger.error({ error }, `Worker #${workerId} encountered an error`);
                worker.terminate();
                this.workers.delete(workerId);
                resolve(false);
            });
        });
    }

    private watchConfig() {
        fs.watch(CONFIG_PATH, (eventType) => {
            if (eventType === 'change') {
                logger.info('config.json changed. Scheduling reload...');

                // Debounce: wait 300ms for additional changes
                if (this.reloadTimeout) {
                    clearTimeout(this.reloadTimeout);
                }

                this.reloadTimeout = setTimeout(() => {
                    if (!this.isReloading) {
                        this.gracefulReload();
                    }
                }, 300);
            }
        });
    }

    private async gracefulReload() {
        if (this.isReloading) {
            logger.warn('Reload already in progress. Skipping...');
            return;
        }

        this.isReloading = true;
        logger.info('Starting graceful reload...');

        try {
            // Validate new configuration
            const configContent = await fs.promises.readFile(CONFIG_PATH, 'utf-8');
            const newConfig = JSON.parse(configContent);

            if (!newConfig.routes || !Array.isArray(newConfig.routes)) {
                throw new Error('New configuration is invalid: "routes" is missing or not an array.');
            }

            logger.info('New configuration validated successfully.');

            // Rolling restart strategy: "Stop-then-Start"
            const currentWorkers = Array.from(this.workers.values());

            for (let i = 0; i < currentWorkers.length; i++) {
                const oldWorker = currentWorkers[i];
                logger.info(`Restarting worker #${oldWorker.workerId}...`);

                // Step 1: Gracefully shutdown the old worker
                await this.gracefulShutdownWorker(oldWorker);

                // Step 2: Start new worker with same ID
                const newWorkerStarted = await this.forkWorker(oldWorker.workerId);

                if (!newWorkerStarted) {
                    logger.error(`Failed to start new worker #${oldWorker.workerId}. Aborting reload to maintain service availability.`);

                    // Try to restart the remaining workers that we haven't touched yet
                    for (let j = i + 1; j < currentWorkers.length; j++) {
                        const remainingWorker = currentWorkers[j];
                        if (this.workers.has(remainingWorker.workerId)) {
                            // This worker is still running, keep it
                            continue;
                        }
                        // This worker was already shut down, try to restart it
                        await this.forkWorker(remainingWorker.workerId);
                    }

                    this.isReloading = false;
                    return;
                }

                logger.info(`Worker #${oldWorker.workerId} restarted successfully.`);
            }

            this.config = newConfig;
            logger.info('Graceful reload completed successfully.');

        } catch (error) {
            logger.error({ error }, 'Failed to reload configuration');
            logger.info('Sticking with the old configuration.');
        } finally {
            this.isReloading = false;
        }
    }

    private async gracefulShutdownWorker(workerInfo: WorkerInfo): Promise<void> {
        if (workerInfo.status === 'stopped') {
            return;
        }

        workerInfo.status = 'shutting_down';

        // Send shutdown command
        workerInfo.worker.postMessage({ command: 'shutdown' });

        // Set timeout for graceful shutdown
        const shutdownTimeout = setTimeout(() => {
            logger.warn(`Worker #${workerInfo.workerId} did not shut down gracefully. Force terminating.`);
            workerInfo.worker.terminate();
        }, 30000); // 30 second timeout

        // Wait for the exit event using the existing exitPromise
        if (workerInfo.exitPromise) {
            await workerInfo.exitPromise;
        }

        clearTimeout(shutdownTimeout);
    }

    private handleSignals() {
        const handle = (signal: NodeJS.Signals) => {
            logger.info(`Received ${signal}. Shutting down master and workers...`);
            this.shutdownAllWorkers();
            process.exit(0);
        };
        process.on('SIGINT', handle);
        process.on('SIGTERM', handle);
    }

    private async shutdownAllWorkers() {
        logger.info(`Shutting down ${this.workers.size} workers.`);
        const shutdownPromises = Array.from(this.workers.values()).map(workerInfo =>
            this.gracefulShutdownWorker(workerInfo)
        );
        await Promise.all(shutdownPromises);
        this.workers.clear();
    }
}

new Master();
