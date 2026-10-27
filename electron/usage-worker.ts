// Entry point of the short-lived usage utility process. It receives one
// request, computes, replies and exits so its memory goes back to the OS.
import { runUsage, type WorkerRequest } from './usage-core'

type ParentPort = {
  on: (event: 'message', listener: (event: { data: WorkerRequest }) => void) => void
  postMessage: (message: unknown) => void
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort

if (parentPort) {
  parentPort.on('message', event => {
    try {
      parentPort.postMessage({ ok: true, result: runUsage(event.data) })
    } catch (error) {
      parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }

    setTimeout(() => process.exit(0), 20)
  })
}
