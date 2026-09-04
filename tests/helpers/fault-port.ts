import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AtomicFsPort, AtomicPublicationProfile } from "../../src/storage/atomic.js";

export type FaultPoint =
  | "after_temp_open"
  | "after_temp_flush"
  | "after_envelope_create"
  | "after_snapshot_replace";

export class InjectedPublicationFault extends Error {
  readonly uncertainPublication = true;

  constructor(readonly point: FaultPoint) {
    super(`injected publication fault: ${point}`);
  }
}

const TEST_PROFILE: AtomicPublicationProfile = {
  supported: true,
  profile: "test-controlled-local-replace",
  crash_safety: "process-crash",
  physical_durability: false,
};

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

export function controlledAtomicFs(root: string, fault?: FaultPoint): AtomicFsPort {
  const absolute = (path: string): string => {
    const candidate = resolve(root, path);
    if (!isContained(resolve(root), candidate)) throw new Error("path escaped controlled repository");
    return candidate;
  };

  return {
    profile: TEST_PROFILE,
    readFile: async (path) => readFile(absolute(path)),
    async createOnce(path, bytes) {
      const target = absolute(path);
      const handle = await open(target, "wx");
      if (fault === "after_temp_open" && path.includes(".tmp-")) {
        await handle.close();
        throw new InjectedPublicationFault(fault);
      }
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      if (fault === "after_envelope_create" && /\/(handoffs|submissions|decisions)\//u.test(path.replaceAll("\\", "/"))) {
        throw new InjectedPublicationFault(fault);
      }
    },
    async flushFile(path) {
      const handle = await open(absolute(path), "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (fault === "after_temp_flush" && path.includes(".tmp-")) {
        throw new InjectedPublicationFault(fault);
      }
    },
    async replaceCurrent(tempPath, targetPath) {
      if (dirname(absolute(tempPath)) !== dirname(absolute(targetPath))) {
        throw new Error("cross-directory replacement refused");
      }
      await rename(absolute(tempPath), absolute(targetPath));
      if (fault === "after_snapshot_replace") throw new InjectedPublicationFault(fault);
    },
    async remove(path) {
      await unlink(absolute(path));
    },
    async quarantineOnce(sourcePath, quarantinePath) {
      try {
        await readFile(absolute(quarantinePath));
        const error = new Error("quarantine already exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await rename(absolute(sourcePath), absolute(quarantinePath));
    },
  };
}
