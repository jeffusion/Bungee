import path from 'path';
import { fork, type ChildProcess } from 'child_process';
import fs from 'fs';
import { logger } from './logger';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const CONFIG_PATH = path.resolve(process.cwd(), 'config.json');
const WORKER_COUNT = process.env.WORKER_COUNT ? parseInt(process.env.WORKER_COUNT) : 2;

interface WorkerInfo {
    process: ChildProcess;
    workerId: number;
    status: 'starting' | 'ready' | 'shutting_down' | 'stopped';
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
            const worker = fork(path.resolve(__dirname, 'worker.ts'), [], {
                env: {
                    ...process.env,
                    WORKER_ID: String(workerId),
                    PORT: String(3000) // 所有worker共享同一个端口
                },
            });

            logger.info(`Forking worker #${workerId} with PID ${worker.pid}`);

            const workerInfo: WorkerInfo = {
                process: worker,
                workerId,
                status: 'starting'
            };

            this.workers.set(workerId, workerInfo);

            // Set a timeout for worker startup
            const startupTimeout = setTimeout(() => {
                logger.error(`Worker #${workerId} (PID: ${worker.pid}) failed to start within timeout`);
                worker.kill();
                this.workers.delete(workerId);
                resolve(false);
            }, 30000); // 30 second timeout

            worker.on('exit', (code, signal) => {
                clearTimeout(startupTimeout);

                if (workerInfo.status === 'shutting_down') {
                    logger.info(`Worker #${workerId} (PID: ${worker.pid}) exited gracefully (code: ${code}, signal: ${signal}).`);
                } else {
                    logger.warn(`Worker #${workerId} (PID: ${worker.pid}) exited unexpectedly with code ${code} and signal ${signal}.`);
                }

                this.workers.delete(workerId);
                if (workerInfo.status === 'starting') {
                    resolve(false);
                }
            });

            worker.on('message', (message: any) => {
                clearTimeout(startupTimeout);
                if (message.status === 'ready') {
                    logger.info(`Worker #${workerId} (PID: ${worker.pid}) reported ready.`);
                    workerInfo.status = 'ready';
                    resolve(true);
                } else if (message.status === 'error') {
                    const errorMsg = message.error || 'Unknown error';
                    logger.error(`Worker #${workerId} (PID: ${worker.pid}) reported an error: ${errorMsg}`);
                    worker.kill();
                    this.workers.delete(workerId);
                    resolve(false);
                }
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
        return new Promise((resolve) => {
            if (workerInfo.status === 'stopped') {
                resolve();
                return;
            }

            workerInfo.status = 'shutting_down';

            // Send shutdown command
            workerInfo.process.send({ command: 'shutdown' });

            // Set timeout for graceful shutdown
            const shutdownTimeout = setTimeout(() => {
                logger.warn(`Worker #${workerInfo.workerId} did not shut down gracefully. Force killing.`);
                workerInfo.process.kill('SIGKILL');
                resolve();
            }, 30000); // 30 second timeout

            workerInfo.process.on('exit', () => {
                clearTimeout(shutdownTimeout);
                workerInfo.status = 'stopped';
                resolve();
            });
        });
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
