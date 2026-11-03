import { Queue, Worker } from "bullmq";
import { config } from "./config";
import { runJob } from "./jobs";

export const QUEUE_NAME = "jobs";

interface JobData {
  jobId: string;
}

const connection = () => ({ url: config.redisUrl, maxRetriesPerRequest: null });

let queue: Queue<JobData> | undefined;

export async function enqueueJob(jobId: string): Promise<void> {
  queue ??= new Queue<JobData>(QUEUE_NAME, { connection: connection() });
  // The job row is the source of truth; the queue entry only says "run this". Retrying is runJob's call.
  await queue.add("run", { jobId }, { jobId, removeOnComplete: 1000, removeOnFail: 1000 });
}

export function startWorker(concurrency = 2): Worker<JobData> {
  return new Worker<JobData>(QUEUE_NAME, (j) => runJob(j.data.jobId), {
    connection: connection(),
    concurrency,
  });
}
